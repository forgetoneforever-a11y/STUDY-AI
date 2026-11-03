const { tavilyKey } = require("./config");

async function searchWeb(query) {
  if (!tavilyKey) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false
    })
  });
  if (!response.ok) throw new Error(`Search API error: ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(item => ({
    title: item.title, url: item.url, content: item.content
  }));
}
module.exports = { searchWeb };
