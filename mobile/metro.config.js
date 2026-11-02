// metro.config.js
//
// Lets the mobile app import the SAME routing and validation files the
// website uses (../public/dealer-assign.js, validate.js, produce.js), so the
// web form and the phone app can never route a lead differently.
//
// Metro only looks inside mobile/ by default; watchFolders adds ../public.

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(__dirname, "../public"),
];

module.exports = config;