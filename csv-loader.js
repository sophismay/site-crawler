'use strict';

var fs = require('fs');
var csv = require('csv-parser');
const CSV_FILE_LOCATION = './clubs-list/clublist.csv'

var stream = csv({
	raw: false,     // do not decode to utf-8 strings 
	separator: ',', // specify optional cell separator 
	quote: '"',     // specify optional quote character 
	escape: '"',    // specify optional escape character (defaults to quote value) 
	newline: '\n',  // specify a newline character 
	strict: false    // require column length NOT match headers length 
});

class CsvLoader {
	constructor() {
		var self = this;
		this.data = [];
		this.loadDone = false;
		var R = new Request();
		fs.createReadStream(CSV_FILE_LOCATION)
			.pipe(stream)
			.on('data', function(row){
				// fields: name, webpage, _id, webpage_conf, webpage, vorstand, kategorie, strasse, plz
				// hausenr, bemerkugen, alternates[0-3], __V, sitz
				//console.log('arrived \n', data);
				// get website and request and check for relative links and calculate confidence level
				R.handleRow(row)
				self.data.push(row);
			})
			.on('end', function(){
				console.log('DONE LOADING CSV DATA')
				self.loadDone = true;
				//console.log(self);
			});
	}

	getData() {
		//while(this.loadDone == false) {
			// block until loaded
			//console.log('inside of while loop now')
			//setTimeout(function(){}, 1000);
		//}
		//console.log('out of while loop now');
		return this.data;
	}

	getCount() {
		return this.loadDone ? this.data.length : 0;
	}
}

var request = require('request');
var cheerio = require('cheerio');
var URL = require('url-parse');

class Request {
	constructor() {
		this.sitePages = {};
		this.confidenceLinks = ['impressum', 'kontakt'];
		// keep track of unresolved sites which couldn't be parsed due to errors
		this.unresolvedSites = []
		// visited websites, so the next alternative can be inferred
		// { id: { row: row-data, visited: [visited_sites] }
		this.visited = {};
	}

	// check if page visited/ tried by id
	isVisited(row) {
		var visited = false;
		Object.keys(this.visited).forEach(function(id, index) {
			if(id == row._id) {
				//visited = true;
				if(this.visited[id].visited.indexOf(webpage) != -1) {
					visited = true;
				}
			}
		});

		return visited;
	}

	idExistsInVisited(id) {
		return Object.keys(this.visited).indexOf(id) != - 1;
	}

	saveVisit(row, webpage) {
		if(this.idExistsInVisited(row._id)) {
			var temp = this.visited[row._id];
			temp.visited.push(webpage);
			this.visited[row._id] = temp;
		} else {
			this.visited[row._id] = { row: row, visited: [webpage] };
		}
	}

	getNextAlternativeWebsite() {

	}

	handleRow(row) {
		if(row.webpage) {
			var url = new URL(row.webpage);
			console.log(url);
			//var baseUrl = url.protocol + "//" + url.hostname;
			// handling possible invlid URI error due to lack of protocol information
			if(!url.protocol){
				url.protocol = 'http:';
				url.hostname = 'www.' + url.href;
			} 
			var baseUrl = url.protocol + "//" + url.hostname;
			console.log('BASE URL; ', baseUrl)
			this.requestPageBody(baseUrl, (err, $) => {
				this.saveVisit(row, row.webpage);
				if(err){
					// Error requesting page, try alternatives
					// TODO: check again definition of isVisited compared to savevisit logically
					// TODO: where to save visit, and where/when to get alternatives, for good flow
					if(this.isVisited(row)) {

					}
					this.visited.push({ _id: row._id, tried: []  })
					console.log("ERROR requesting page")
				} else {
					console.log("CHeerio: ", $)
					var relativeLinks = this.collectRelativeLinks($, baseUrl);
					//console.log(relativeLinks);
					//console.log('SITE PAGES object', sitePages);
				}
			});
		}
	}

	requestPageBody(baseUrl, cb) {
		console.log('Visiting Page: ', baseUrl);
		request(baseUrl, (error, response, body) => {
			if(error) {
				this.unresolvedSites.push({ baseUrl: baseUrl, error: error })
				return cb(error);
			}
			// Check status code (200 is HTTP OK)
			console.log("Error request page: ",  error);
			console.log("Status code: " + response.statusCode);
			if(response.statusCode !== 200) {
				return cb({ msg: "Status code NOT 200" }, null);
			}
			// Parse the document body
	     	var $ = cheerio.load(body);

	     	return cb(null, $);
		});
	}

	collectRelativeLinks($, baseUrl) {
		var relativeLinks = $("a[href^='/']");
	    console.log("Found " + relativeLinks.length + " relative links on website " + baseUrl);
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
	    this.sitePages[baseUrl] = { pages: rLinks, confidence: this.calculateConfidenceLevel(rLinks)}
	    return rLinks;
	}

	calculateConfidenceLevel(relativeLinks) {
		var level = 0;
		this.confidenceLinks.forEach( (cl, index) => {
			if(relativeLinks.indexOf(cl) >= 0) {
				level = level + 0.5
			}
		});

		return level;
	}
}

module.exports = CsvLoader