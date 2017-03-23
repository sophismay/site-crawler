"use strict";

var Loader = require('./csv-loader');
var csv = require('csv-parser');

var websites = ['http://www.myjoyonline.com'];
var confidenceLinks = ['impressum', 'kontakt'];
// object for each page and its relative links, with confidence level
// eg {'http://www.google.com': {pages: ['impressum', 'kontakt'], confidence: 1}}
var sitePages = {}

var L = new Loader();
