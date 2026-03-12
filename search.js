#!/usr/bin/env node
import { BraveSearch } from "brave-search";

const API_KEY = process.env.BRAVE_API_KEY;
if (!API_KEY) {
  console.error("Error: BRAVE_API_KEY environment variable not set");
  process.exit(1);
}

const braveSearch = new BraveSearch(API_KEY);

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("Usage: node search.js <query>");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let count = 5;
  let includeContent = false;
  let queryStr = query;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      queryStr = args.slice(0, i).join(" ") + " " + args.slice(i + 2).join(" ");
      i++;
    } else if (args[i] === "--content") {
      includeContent = true;
      queryStr = args.slice(0, i).join(" ") + " " + args.slice(i + 1).join(" ");
    }
  }

  queryStr = queryStr.trim();

  try {
    const results = await braveSearch.webSearch(queryStr, {
      count: count,
      safesearch: "off",
    });

    if (results.web && results.web.results) {
      results.web.results.forEach((result, idx) => {
        console.log(`--- Result ${idx + 1} ---`);
        console.log(`Title: ${result.title}`);
        console.log(`Link: ${result.url}`);
        if (result.age) console.log(`Age: ${result.age}`);
        if (result.description) console.log(`Snippet: ${result.description}`);
        console.log("");
      });
    } else {
      console.log("No results found");
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
