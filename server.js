require("dotenv").config();
const express = require("express");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;
const URL = process.env.URL_TO_SCRAPE;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const scrapeFlights = async () => {
  // Recupera il percorso esatto di Chromium installato
  const chromiumPath = path.join(process.cwd(), "node_modules", "puppeteer", ".local-chromium", "linux-127.0.6533.88", "chrome-linux", "chrome");

  if (!fs.existsSync(chromiumPath)) {
    console.error("❌ Chromium non trovato nel percorso:", chromiumPath);
    throw new Error("Chromium non installato correttamente.");
  }

  console.log("✅ Chromium trovato in:", chromiumPath);

  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
  const page = await browser.newPage();

  console.log("🌍 Navigo alla pagina...");
  await page.goto(URL, { waitUntil: "networkidle2" });

  // 📌 Step 1: Chiudere il banner dei cookie SE ESISTE
  const cookieButton = await page.$("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection");

  if (cookieButton) {
    console.log("🍪 Banner cookie trovato! Clicco per accettare...");
    await cookieButton.click();
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log("✅ Nessun banner cookie trovato.");
  }

  // 📌 Step 2: Cliccare "Mostra di più" finché ci sono voli nascosti
  let hasMore = true;

  while (hasMore) {
    try {
      const showMoreLink = await page.$("#show-more-flights");

      if (!showMoreLink) {
        console.log("✅ Nessun altro link 'Mostra di più' trovato.");
        break;
      }

      let flightsBefore = await page.evaluate(() => 
        document.querySelectorAll(".single-flight").length
      );

      console.log(`🔄 Scorro la pagina e clicco 'Mostra di più'... (${flightsBefore} voli visibili)`);

      // 📌 Step 3: Scorrere fino in fondo prima di cliccare
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await new Promise(r => setTimeout(r, 2000));

      // 📌 Step 4: Simulare un click sul link <a>
      await page.evaluate(() => {
        document.querySelector("#show-more-flights").click();
      });

      // 📌 Step 5: Aspettare il caricamento di nuovi voli
      await page.waitForFunction(
        previousCount => document.querySelectorAll(".single-flight").length > previousCount,
        { timeout: 8000 },
        flightsBefore
      );

      console.log("✅ Nuovi voli caricati!");
      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      console.log("✅ Tutti i voli sono stati caricati o il link non è più visibile.");
      hasMore = false;
    }
  }

  // 📌 Step 6: Estrarre i dati con Cheerio
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  let flights = [];

  $(".single-flight").each((index, element) => {
    let fromDate = $(element).find(".active-from").text().trim() || null;
    let toDate = $(element).find(".active-to").text().trim() || null;
    let isSingleDay = $(element).find(".value").text().includes("Attivo il");

    const flight = {
      destination: $(element).find(".volo .regularity").first().text().trim(),
      flightNumber: $(element).find(".n_flight").first().text().trim().replace(/\s+/g, " "), 
      airline: $(element).find(".airline-name").first().text().trim().replace(/(.+)\1$/, "$1"),
      period: isSingleDay ? { single: fromDate } : { from: fromDate, to: toDate },
      time: $(element).find(".orario").clone().children().remove().end().text().trim(),
      frequency: $(element).find(".frequenza .regularity").text().trim()
    };

    flights.push(flight);
  });

  // 📌 Step 7: Salvare i dati
  fs.writeFileSync("data.json", JSON.stringify(flights, null, 2));
  console.log(`✅ Dati salvati in data.json (${flights.length} voli trovati)`);
}

// 📌 Esegue lo scraping ogni giorno alle 3:00 di notte
cron.schedule("0 3 * * *", () => {
  scrapeFlights();
});

app.get("/api/data", (req, res) => {
  try {
    const fileData = fs.readFileSync("data.json");
    res.json(JSON.parse(fileData));
  } catch (error) {
    res.status(500).json({ message: "Errore nel recupero dei dati" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto su http://localhost:${PORT}`);
  scrapeFlights();
});
