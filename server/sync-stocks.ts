import { downloadCatalog } from "./catalog";
const result = await downloadCatalog();
console.log(
  JSON.stringify({
    updatedAt: result.updatedAt,
    kospi: result.stocks.filter((s) => s.market === "KOSPI").length,
    kosdaq: result.stocks.filter((s) => s.market === "KOSDAQ").length,
  }),
);
