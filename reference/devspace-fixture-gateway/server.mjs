import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";

const port = Number(process.env.PORT ?? 4000);
const backendBaseUrl = process.env.BACKEND_BASE_URL ?? "http://backend:8000";

const server = new ApolloServer({
  typeDefs: `#graphql
    type Todo {
      id: ID!
      title: String!
      status: String!
      source: String!
    }

    type Query {
      health: String!
      todos: [Todo!]!
    }
  `,
  resolvers: {
    Query: {
      health: async () => {
        const response = await fetch(`${backendBaseUrl}/healthz`);
        if (!response.ok) {
          throw new Error(`backend_health_http_${response.status}`);
        }
        const body = await response.json();
        return `gateway-ok -> ${body.status}`;
      },
      todos: async () => {
        const response = await fetch(`${backendBaseUrl}/todos`);
        if (!response.ok) {
          throw new Error(`backend_todos_http_${response.status}`);
        }
        return response.json();
      },
    },
  },
});

await startStandaloneServer(server, {
  listen: { port },
});

console.log(`gateway_listening:${port}`);
