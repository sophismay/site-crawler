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

var keyword_extractor = require("keyword-extractor");

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
				R.handleRow(row);
				self.data.push(row);
			})
			.on('end', function(){
				console.log('DONE LOADING CSV DATA');
				// call R function from here
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
		// { id: { row: row-data, visited: [visited_sites], confidenceLevels: [Number] } }
		// array of confidence levels must be same order as visited sites
		this.visited = {};

		// data structure to store details of clubs with ConfidenceLevel above threshold
		// [{name: String, url: String}]
		this.confirmedClubs = [];

		// data structure to store details of clubs which failed all 3 CL tests(including alternatives)
		// even though impressum was found
		// [{name: String, urls: [{url: String, CL: Number}]}]
		this.unconfirmedClubs = [];
		// data structure for clubs with no impressum found
		// 
		this.failedClubs = [];
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
			this.visited[row._id] = { row: row, visited: [webpage], confidenceLevels: [] };
		}
	}

	getRowData(id) {
		return this.idExistsInVisited(id) ? this.visited[id] : null;
	}

	// go through visited pages and get next alternative from row
	getNextAlternativeWebsite(row) {
		var id = row._id;
		var dataWithRowAndVisits = this.getRowData(id);
		// TODO: handle well
		if(!dataWithRowAndVisits) {
			//console.error('NO ALTERNaTIve');
			return row.webpage;
			//return null;
		} else {
			var visits = dataWithRowAndVisits.visited;
			// nothing visited so send first webpage
			if(!visits) {
				return dataWithRowAndVisits.row.webpage;
			}
			// get next alternative
			var alternatives = [];
			var next = undefined;
			//alternatives.push(dataWithRowAndVisits.row.webpage);
			alternatives.push(dataWithRowAndVisits.row['alternates[0]']);
			alternatives.push(dataWithRowAndVisits.row['alternates[1]']);
			alternatives.push(dataWithRowAndVisits.row['alternates[2]']);
			alternatives.push(dataWithRowAndVisits.row['alternates[3]']);
			// with the assumption of order and that requests and attempted in order
			alternatives.forEach(function(alt, ind) {
				// make sure next alternative is only set if not previously set
				// to avoid value override
				if(visits.indexOf(alt) == -1) {
					if(next == undefined) {
						next = alt;
					}
				}
			});
			// if undefined next alternative is first alternative
			/*if(next == undefined) {
				next = dataWithRowAndVisits.row['alternative[0]'];
			}*/

			return next;
		}
	}

	getImpressumLink(links) {
		var impressumLink = undefined;
		links.forEach(function(link, index){
			if(/impressum/i.test(link)) {
			//if(link.toLowerCase().indexOf('impressum') != -1) {
				impressumLink = link;
			}
		});
		return impressumLink;
	}

	saveConfidenceLevel(id, level) {
		if(this.idExistsInVisited(id)) {
			var temp = this.visited[id];
			temp.confidenceLevels.push(level);
			this.visited[id] = temp;
		}
	}

	pageConfidence(body, name, cb) {
			var extraction_result = keyword_extractor.extract(name,{
                language:"german",
                return_changed_case:false,
                remove_duplicates: true

           });
			var resultLength = extraction_result.length;
			var encountered = 0;
			extraction_result.forEach(function (keyword) {
				var matcher = new RegExp(keyword, 'i');
				if(matcher.test(body)) {
					encountered += 1;
				}
			});
			// check encountered and confirm
			// if size is 2, expect total words occurence
			var ratio = encountered/resultLength;
			if(resultLength <= 2) {
				if(ratio == 1) {
					return cb(1);
				} else {
					return cb(0);
				}
			} else {
				return cb(ratio);
			}
	}

	// function called with row
	// get next attempt from row
	// save attempt (visit)
	// compute base url
	// request page body with url
	// if error:
	//   call this function again
	//   // calling function again will attempt request with next alternative
	handleRow(row) {
		var self = this;
		// get next webpage to attempt request
		var nextPagetoAttempt = this.getNextAlternativeWebsite(row);
		//console.log('next page attempt ', nextPagetoAttempt, row);
		// only try if there's a page to attempt
		if(nextPagetoAttempt) {
			// save attempt
			this.saveVisit(row, nextPagetoAttempt);
			// compute base url
			var url = new URL(nextPagetoAttempt);

			//console.log(url);
			// handling possible invlid URI error due to lack of protocol information
			if(!url.protocol){
				url.protocol = 'http:';
				url.hostname = 'www.' + url.href;
			} 
			var baseUrl = url.protocol + "//" + url.hostname;
			//console.log('BASE URL; ', baseUrl);
			// request for page body with url
			this.requestPageBody(baseUrl, (err, $) => {
				//this.saveVisit(row, row.webpage);
				// do this when no impressum
				if(err){
					// Error requesting page, try alternatives
					// call function again to attempt next alternative
					//console.log("ERROR requesting page ", baseUrl);
					this.handleRow(row);
				} else {
					//console.log("CHeerio: ", $)
					var relativeLinks = this.collectRelativeLinks($, baseUrl);
					// if impressum exists, then query impressum page
					var impressumLink = this.getImpressumLink(relativeLinks);
					if(impressumLink != undefined) {
						var impressumUrl = url.protocol + "//" + url.hostname + "/" + impressumLink; 
						//if(impressumUrl.indexOf('TopNav') != -1) {
							console.log('impressum URL: ', impressumUrl);
						//}
						
						this.requestPageBody(impressumUrl, function(err, $) {
							if(err) {
								//console.log('ErRROR REQUESTING IMPRESSUM LINK', err);
								return;
							}
							//console.log('IMPRESSUM BODY: ', $);
							//console.log($.html());
							self.pageConfidence($.html(), row.name, function(confidenceLevel) {
								console.log(confidenceLevel);
								// check next alternative if lower than threshold
								var threshold = 0.6;
								// same confidence level before checking next alternative
								this.saveConfidenceLevel(row._id, cl);
								if(threshold <= confidenceLevel) {

								} else {
									this.handleRow(row);
								}
							});
						});
					} else {
						// query next alternative
						this.handleRow(row);
					}
					//console.log(relativeLinks);
					//console.log('SITE PAGES object', sitePages);
				}
			});
		} else {
			// TODO: if no next alternative
		}

		/*if(row.webpage) {
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
					// get next alternative and attempt request again
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
		}*/
	}

	requestPageBody(baseUrl, cb) {
		//console.log('Visiting Page: ', baseUrl);
		request(baseUrl, (error, response, body) => {
			if(error) {
				this.unresolvedSites.push({ baseUrl: baseUrl, error: error })
				return cb(error);
			}
			// Check status code (200 is HTTP OK)
			//console.log("Error request page: ",  error);
			//console.log("Status code: " + response.statusCode);
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
	    //console.log("Found " + relativeLinks.length + " relative links on website " + baseUrl);
	    //console.log(relativeLinks);
	    // obtain only relative links from structure
	    var rLinks = [];
	    var count = 1;
	    relativeLinks.each( (l, i) => {
	    	var hrefWithoutSlash = relativeLinks[l].attribs.href.replace('/', '');
	   		rLinks.push(hrefWithoutSlash);
	    	//rLinks.push($(this).attr('href'));
	    //console.log('rLinks')
	    	
	    });
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