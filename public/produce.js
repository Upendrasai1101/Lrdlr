// produce.js
//
// Purely cosmetic: the demo data names dealers after vegetables and
// customers after fruits, so the UI shows a matching emoji. It looks at
// the FIRST word of a name. A name that is not a fruit or vegetable (for
// example a real customer typed into the form) just gets no emoji.

const PRODUCE = {
  // vegetables (dealers)
  tomato: "🍅", brinjal: "🍆", carrot: "🥕", cabbage: "🥬", potato: "🥔", onion: "🧅",
  // fruits (customers)
  apple: "🍎", banana: "🍌", cherry: "🍒", dates: "🌴", fig: "🫐", guava: "🍐",
  grapes: "🍇", jackfruit: "🍈", kiwi: "🥝", lemon: "🍋", lychee: "🍒", mango: "🥭",
  melon: "🍈", orange: "🍊", papaya: "🥭", peach: "🍑", pear: "🍐", pineapple: "🍍",
  plum: "🫐", pomegranate: "🍎", sapota: "🥔", strawberry: "🍓", watermelon: "🍉",
  custard: "🍏", amla: "🫒", apricot: "🍑", avocado: "🥑", blueberry: "🫐",
  coconut: "🥥", cranberry: "🍒", dragon: "🐉", gooseberry: "🫒", jamun: "🫐",
  mulberry: "🍇",
  // fruits in public/sample-leads.csv
  raspberry: "🍓", tamarind: "🫘", starfruit: "⭐", persimmon: "🍊", quince: "🍐",
  grapefruit: "🍊", olive: "🫒", nectarine: "🍑", durian: "🥥", longan: "🍇",
  // fruits in public/sample-typos.csv
  cantaloupe: "🍈", elderberry: "🫐", lime: "🍋", honeydew: "🍈",
};

export function produceEmoji(name) {
  if (name === "In-house Sales") return "🏠";
  const first = String(name || "").trim().split(/\s+/)[0].toLowerCase();
  return PRODUCE[first] || "";
}