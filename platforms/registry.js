import hackerone from "./hackerone.js";
import intigriti from "./intigriti.js";
import yeswehack from "./yeswehack.js";

const adapters = [hackerone, intigriti, yeswehack];

export function getAdapter(url) {
  return adapters.find((adapter) => adapter.matches(url)) || null;
}
