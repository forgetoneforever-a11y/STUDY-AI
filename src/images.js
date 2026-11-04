const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKI_API = "https://ru.wikipedia.org/w/api.php";

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "STUDY-AI/1.0 (educational assistant)" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Image provider returned ${response.status}`);
  return response.json();
}

function clean(value, max = 250) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().slice(0, max);
}

async function commonsSearch(query, limit) {
  const search = new URLSearchParams({
    action: "query", list: "search", srnamespace: "6",
    srsearch: query, srlimit: String(limit), srprop: "title",
    format: "json"
  });
  const found = await getJson(`${COMMONS_API}?${search}`);
  const titles = (found.query?.search || []).map(x => x.title).filter(Boolean);
  if (!titles.length) return [];
  const details = new URLSearchParams({
    action: "query", prop: "imageinfo", titles: titles.join("|"),
    iiprop: "url|extmetadata", iiurlwidth: "1100", format: "json"
  });
  const data = await getJson(`${COMMONS_API}?${details}`);
  return Object.values(data.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0];
    if (!info) return null;
    const meta = info.extmetadata || {};
    const url = info.thumburl || info.url;
    if (!url || !/^https:\/\//i.test(url)) return null;
    return {
      url,
      title: clean(page.title?.replace(/^File:/, ""), 180),
      pageUrl: info.descriptionurl || "",
      description: clean(meta.ImageDescription?.value, 300),
      author: clean(meta.Artist?.value, 120),
      license: clean(meta.LicenseShortName?.value, 60)
    };
  }).filter(Boolean);
}

async function wikipediaSearch(query, limit) {
  const search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrlimit: String(limit), prop: "pageimages|info",
    piprop: "thumbnail", pithumbsize: "1000",
    inprop: "url", format: "json"
  });
  const data = await getJson(`${WIKI_API}?${search}`);
  return Object.values(data.query?.pages || {}).map(page => {
    const url = page.thumbnail?.source;
    if (!url || !/^https:\/\//i.test(url)) return null;
    return {
      url, title: clean(page.title, 180),
      pageUrl: page.fullurl || `https://ru.wikipedia.org/?curid=${page.pageid}`,
      description: "Иллюстрация из статьи Википедии",
      author: "", license: "Wikimedia"
    };
  }).filter(Boolean);
}

async function findTopicImages(topic, limit = 2) {
  const query = String(topic || "").trim().slice(0, 240);
  if (!query) return [];
  const count = Math.min(Math.max(Number(limit) || 2, 1), 3);
  try {
    const direct = await commonsSearch(query, count);
    if (direct.length) return direct.slice(0, count);
  } catch (error) {
    console.warn("Wikimedia Commons search failed:", error.message);
  }
  try {
    const wiki = await wikipediaSearch(query, count);
    if (wiki.length) return wiki.slice(0, count);
  } catch (error) {
    console.warn("Wikipedia image search failed:", error.message);
  }
  // Retry Commons with a shorter query if the original wording is too specific.
  const words = query.split(/\s+/).filter(word => word.length > 2).slice(0, 3);
  if (words.length > 1) {
    try { return (await commonsSearch(words.join(" "), count)).slice(0, count); }
    catch (error) { console.warn("Fallback image search failed:", error.message); }
  }
  return [];
}

module.exports = { findTopicImages };
