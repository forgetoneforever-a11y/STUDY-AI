const API = "https://commons.wikimedia.org/w/api.php";

async function findTopicImages(topic, limit = 2) {
  const query = String(topic || "").trim().slice(0, 300);
  if (!query) return [];
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(Math.max(limit, 1), 4)),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1000",
    format: "json"
  });
  const response = await fetch(`${API}?${params}`, {
    headers: { "User-Agent": "STUDY-AI/1.0 (educational study assistant)" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Image search failed: ${response.status}`);
  const data = await response.json();
  const pages = Object.values(data.query?.pages || {});
  return pages.map(page => {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata || {};
    const description = meta.ImageDescription?.value || "";
    const author = meta.Artist?.value || "";
    const license = meta.LicenseShortName?.value || "";
    const url = info?.thumburl || info?.url;
    if (!url || !/^https:\/\//i.test(url)) return null;
    return {
      url,
      title: String(page.title || "").replace(/^File:/, ""),
      pageUrl: info?.descriptionurl || "",
      description: description.replace(/<[^>]*>/g, "").slice(0, 350),
      author: author.replace(/<[^>]*>/g, "").slice(0, 160),
      license: license.slice(0, 80)
    };
  }).filter(Boolean);
}
module.exports = { findTopicImages };
