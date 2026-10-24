"use strict";
// The browser core: pure functions, no DOM access, no network. Each file mirrors one Python
// module in src/fieldservice and web/parity.test.mjs checks the two against tests/vectors.json.
// The files are joined in name order into one script; 99_api.js builds the public object.
//
// The product name lives here and in src/fieldservice/brand.py, nowhere else in code.
const PRODUCT_NAME = "Turnout";
const SUITE_NUMBER = 17;
const BACKUP_FORMAT = "field-tools-17-service";
const BACKUP_VERSION = 1;
const PACKET_FORMAT = "field-tools-17-job-packet";
const PACKET_VERSION = 1;
