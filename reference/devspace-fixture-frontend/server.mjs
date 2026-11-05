import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const port = Number(process.env.PORT ?? 3000);
const gatewayGraphqlUrl = process.env.GATEWAY_GRAPHQL_URL ?? "http://gateway:4000/graphql";

const app = express();

app.get("/healthz", (_request, response) => {
  response.json({ ok: true, service: "frontend" });
});

app.get("/", async (_request, response) => {
  try {
    const payload = await fetchGatewayData();
    const html = renderPage(payload);
    response.type("html").send(`<!doctype html>${html}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(502).type("text/plain").send(`frontend_render_failed:${message}`);
  }
});

app.listen(port, () => {
  console.log(`frontend_listening:${port}`);
});

async function fetchGatewayData() {
  const gatewayResponse = await fetch(gatewayGraphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query SmokePage { health todos { id title status source } }`,
    }),
  });

  if (!gatewayResponse.ok) {
    throw new Error(`gateway_http_${gatewayResponse.status}`);
  }

  const body = await gatewayResponse.json();
  if (body.errors?.length) {
    throw new Error(`gateway_graphql_error:${body.errors[0]?.message ?? "unknown"}`);
  }

  return body.data;
}

function renderPage(data) {
  const element = React.createElement(
    "html",
    { lang: "en" },
    React.createElement(
      "body",
      {
        style: {
          fontFamily: "system-ui, sans-serif",
          margin: "2rem auto",
          maxWidth: "48rem",
          lineHeight: 1.5,
          padding: "0 1rem",
        },
      },
      React.createElement("h1", null, "Piphony DevSpace fixture"),
      React.createElement("p", null, "Frontend -> GraphQL gateway -> FastAPI backend -> Postgres"),
      React.createElement("p", { id: "gateway-health" }, `Gateway health: ${data.health}`),
      React.createElement(
        "ul",
        { id: "todo-list" },
        ...data.todos.map((todo) => React.createElement(
          "li",
          { key: todo.id },
          React.createElement("strong", null, todo.title),
          " — ",
          todo.status,
          " — ",
          todo.source,
        )),
      ),
    ),
  );

  return renderToStaticMarkup(element);
}
