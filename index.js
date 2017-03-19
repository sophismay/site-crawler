"use strict";
var request = require('request');
var cheerio = require('cheerio');
var URL = require('url-parse');
var Loader = require('./csv-loader');
//var csvParser = require('csv-parse');
var fs = require('fs');
var csv = require('csv-parser');
//var xlsx = require('xlsx');

var websites = ['http://www.myjoyonline.com'];
var confidenceLinks = ['impressum', 'kontakt'];
// object for each page and its relative links, with confidence level
// eg {'http://www.google.com': {pages: ['impressum', 'kontakt'], confidence: 1}}
var sitePages = {}

/*var stream = csv({
	raw: false,     // do not decode to utf-8 strings 
	separator: ',', // specify optional cell separator 
	quote: '"',     // specify optional quote character 
	escape: '"',    // specify optional escape character (defaults to quote value) 
	newline: '\n',  // specify a newline character 
	strict: false    // require column length NOT match headers length 
});*/
/*fs.createReadStream('./clubs-list/clublist.csv')
	.pipe(stream)
	.on('data', function(data){
		// fields: name, webpage, _id, webpage_conf, webpage, vorstand, kategorie, strasse, plz
		// hausenr, bemerkugen, alternates[0-3], __V, sitz
		console.log('arrived \n', data)
	})
	.on('end', function(){
		console.log('DONE LOADING CSV DATA')
	});*/

var L = new Loader();
//setTimeout(function(){ console.log('Whiling') }, 2000);
//console.log(L);
//L.getData();
//console.log(L.getCount());
//console.log(L.getData().length);
//console.log(L.getCount())


// iterate through websites
// and assign confidence depending on existence of paths kontakt and impressum
websites.forEach((website, index) => {
	var url = new URL(website)
	var baseUrl = url.protocol + "//" + url.hostname;
	console.log('BASE URL; ', baseUrl)
	requestPageBody(baseUrl, (err, $) => {
		if(err){
			console.log("ERROR requesting page")
		} else {
			console.log("CHeerio: ", $)
			var relativeLinks = collectRelativeLinks($, baseUrl);
			//console.log(relativeLinks);
			//console.log('SITE PAGES object', sitePages);
		}
	});
	
});

function collectRelativeLinks($, baseUrl) {
	var relativeLinks = $("a[href^='/']");
    console.log("Found " + relativeLinks.length + " relative links on page");
    //console.log(relativeLinks);
    // obtain only relative links from structure
    var rLinks = [];
    var count = 1;
    relativeLinks.each( (l, i) => {
    	var hrefWithoutSlash = relativeLinks[l].attribs.href.replace('/', '')
   		rLinks.push(hrefWithoutSlash.toLowerCase());
    	//rLinks.push($(this).attr('href'));
    	
    });
    //console.log('rLinks')
    //console.log(rLinks);
    sitePages[baseUrl] = { pages: rLinks, confidence: calculateConfidenceLevel(rLinks)}
    return rLinks;
}

function calculateConfidenceLevel(relativeLinks) {
	var level = 0;
	confidenceLinks.forEach( (cl, index) => {
		if(relativeLinks.indexOf(cl) >= 0) {
			level = level + 0.5
		}
	});

	return level;
}

function requestPageBody(baseUrl, cb) {
	console.log('Visiting Page: ', baseUrl);
	request(baseUrl, (error, response, body) => {
		// Check status code (200 is HTTP OK)
		console.log("Status code: " + response.statusCode);
		if(response.statusCode !== 200) {
			return cb({ msg: "Status code NOT 200" }, null);
		}
		// Parse the document body
     	var $ = cheerio.load(body);

     	return cb(null, $);
	});
}