import { importAssetsFromCsvText, queueImageRecognition } from "./modules/assets.js";
import { getSession, login } from "./modules/auth.js";
import { getQuotes } from "./modules/prices.js";
import { connectProvider, getConnection, syncHoldingsFromNotion } from "./modules/sync.js";

export function createServer() {
  return {
    status: "api server placeholder",

    auth: {
      login,
      getSession
    },

    sync: {
      connectProvider,
      getConnection,
      syncHoldingsFromNotion
    },

    market: {
      getQuotes
    },

    assets: {
      importAssetsFromCsvText,
      queueImageRecognition
    }
  };
}
