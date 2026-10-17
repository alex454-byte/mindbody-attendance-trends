#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./config.js";
import { createServer } from "./server.js";

const server = createServer(configFromEnv());
await server.connect(new StdioServerTransport());
