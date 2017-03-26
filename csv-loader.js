'use strict';

var fs = require('fs');
var csv = require('csv-parser');
var node_xj = require("xls-to-json");
const CSV_FILE_LOCATION = './clubs-list/clublist.csv';
const low = require('lowdb');
const checkDb = low('checkedb.json');
const db = low('db.json');
var unconfirmedSize = 0;
var confirmedSize = 0;
var failedSize = 0;
var confirmedNames = checkDb.get('confirmed').map('name').value();
var unconfirmedNames = checkDb.get('unconfirmed').map('name').value();
var faileddNames = checkDb.get('failed').map('name').value();
var processedNames = confirmedNames.concat(unconfirmedNames);
processedNames = processedNames.concat(faileddNames);
processedNames.forEach(function (val) {
	val = val.replace(/\\/g, '');
	//console.log(val);
})
db.defaults({ confirmed: [], unconfirmed: [], failed: [], unconfirmedSize: {}, failedSize: {}, confirmedSize: {} }).write();

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
		var count = 0;
		fs.createReadStream(CSV_FILE_LOCATION)
			.pipe(stream)
			.on('data', function (row) {
				// fields: name, webpage, _id, webpage_conf, webpage, vorstand, kategorie, strasse, plz
				// hausenr, bemerkugen, alternates[0-3], __V, sitz
				//console.log('arrived \n', data);
				// get website and request and check for relative links and calculate confidence level
				if (parseInt(row.webpage_conf) < 0.8 || row.plz.length < 1) {
					var name = row.name.replace(/'/g, "");
					if (processedNames.indexOf(name) == -1) {
						R.handleRow(row);
						self.data.push(row);
						//console.log(name);
						//count +=1;
					}
					//R.handleRow(row);
					//self.data.push(row);
				} else {
					//Manually done 
				}
			})
			.on('end', function () {
				console.log('DONE LOADING CSV DATA');
				console.log(count);
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
		// { id: { row: row-data, visited: [visited_sites], confidenceLevels: [Number], sameCity: [] } }
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
		Object.keys(this.visited).forEach(function (id, index) {
			if (id == row._id) {
				//visited = true;
				if (this.visited[id].visited.indexOf(webpage) != -1) {
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
		if (this.idExistsInVisited(row._id)) {
			var temp = this.visited[row._id];
			temp.visited.push(webpage);
			this.visited[row._id] = temp;
		} else {
			this.visited[row._id] = { row: row, visited: [webpage], confidenceLevels: [], sameCity: [] };
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
		if (!dataWithRowAndVisits) {
			//console.error('NO ALTERNaTIve');
			return row.webpage;
			//return null;
		} else {
			var visits = dataWithRowAndVisits.visited;
			// nothing visited so send first webpage
			if (!visits) {
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
			alternatives.forEach(function (alt, ind) {
				// make sure next alternative is only set if not previously set
				// to avoid value override
				if (visits.indexOf(alt) == -1) {
					if (next == undefined) {
						next = alt;
					}
				}
			});
			// if undefined next alternative is first alternative

			return next;
		}
	}

	saveConfidenceLevel(id, level, sameCity) {
		if (this.idExistsInVisited(id)) {
			var temp = this.visited[id];
			temp.confidenceLevels.push(level);
			temp.sameCity.push(sameCity);
			this.visited[id] = temp;
		}
	}

	pageConfidence(body, name, city, cb) {
		var extraction_result = keyword_extractor.extract(name, {
			language: "german",
			return_changed_case: false,
			remove_duplicates: true

		});
		var encountered = 0;
		var sameCity = false;

		//Remove darmstadt from the string
		extraction_result.forEach(function (keyword, i, arr) {
			if (/darmstadt/i.test(keyword)) {
				arr.splice(i, 1);
			}
		});

		var resultLength = extraction_result.length;

		extraction_result.forEach(function (keyword) {
			var matcher = new RegExp(keyword, 'i');
			if (matcher.test(body)) {
				encountered += 1;
			}
		});


		var cityMatcher = new RegExp(city.toLowerCase(), 'i');
		if (cityMatcher.test(body) && (encountered / resultLength) > 0.5 || /darmstadt/i.test(body)) {//If city is true
			sameCity = true;
		}
		// check encountered and confirm
		// if size is 2, expect total words occurence
		var ratio = encountered / resultLength;
		if (resultLength <= 2) {
			if (ratio == 1) {
				return cb(1, sameCity);
			} else {
				return cb(0, sameCity);
			}
		} else {
			return cb(ratio, sameCity);
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
		if (nextPagetoAttempt) {
			// save attempt
			this.saveVisit(row, nextPagetoAttempt);
			// compute base url
			var url = new URL(nextPagetoAttempt);

			//console.log(url);
			// handling possible invlid URI error due to lack of protocol information
			if (!url.protocol) {
				url.protocol = 'http:';
				url.hostname = 'www.' + url.href;
			}
			var baseUrl = url.protocol + "//" + url.hostname;
			//console.log('BASE URL; ', baseUrl);
			// request for page body with url
			this.requestPageBody(baseUrl, (err, $) => {
				//this.saveVisit(row, row.webpage);
				// do this when no impressum
				if (err) {
					// Error requesting page, try alternatives
					// call function again to attempt next alternative
					//console.log("ERROR requesting page ", baseUrl);
					this.handleRow(row);
				} else {
					//Get impressum link
					var impressumLink = this.getImpressumLink($, baseUrl);
					if (impressumLink.length > 1) {
						// if impressum exists, then query impressum page
						//console.log('attempting impressum url: ' + impressumLink);
						//var impressumUrl = url.protocol + "//" + url.hostname + "/" + impressumLink;
						//if(impressumUrl.indexOf('TopNav') != -1) {
						//console.log('impressum URL: ', impressumUrl);
						//}

						this.requestPageBody(impressumLink, function (err, $) {
							if (err) {
								//console.log('ErRROR REQUESTING IMPRESSUM LINK', err);
								return;
							}
							//console.log('IMPRESSUM BODY: ', $);
							//console.log($.html());
							self.pageConfidence($.html(), row.name, row.sitz, function (confidenceLevel, sameCity) {
								// check next alternative if lower than threshold
								var threshold = 0.51;
								// same confidence level before checking next alternative
								self.saveConfidenceLevel(row._id, confidenceLevel, sameCity);
								if (threshold <= confidenceLevel || 0.5 == confidenceLevel && sameCity) {
									//If higher than threshold save to confirmed array
									db.get('confirmed')
										.push({ name: row.name, url: baseUrl, confidenceLevel: confidenceLevel, sameCity: sameCity, city: row.sitz })
										.write();
									confirmedSize += 1;
									db.set('confirmedSize.size', confirmedSize)
										.write();

								} else {
									self.handleRow(row);
								}
							});
						});
					} else {
						//console.log(relativeLinks);
						// query next alternative
						this.handleRow(row);
					}
					//console.log(relativeLinks);
					//console.log('SITE PAGES object', sitePages);
				}
			});
		} else {
			if (this.idExistsInVisited(row._id)) {
				var visitedRow = this.getRowData(row._id);
				console.log('Unconfirmed!');
				console.log(visitedRow);
				// Add to local database
				if (visitedRow.confidenceLevels.length > 0) {//Impressum was found, but is unlikely to be correct one
					db.get('unconfirmed')
						.push({ name: visitedRow.row.name, urls: visitedRow.visited, confidenceLevels: visitedRow.confidenceLevels, sameCity: visitedRow.sameCity, city: visitedRow.row.sitz })
						.write();
					unconfirmedSize += 1;
					db.set('unconfirmedSize.size', unconfirmedSize)
						.write();
				} else { //No impressum found
					db.get('failed')
						.push({ name: visitedRow.row.name, urls: visitedRow.visited, confidenceLevels: visitedRow.confidenceLevels, city: visitedRow.row.sitz })
						.write();
					failedSize += 1;
					db.set('failedSize.size', failedSize)
						.write();
				}

			}
			// TODO: if no next alternative
		}

	}

	requestPageBody(baseUrl, cb) {
		//console.log('Visiting Page: ', baseUrl);
		request(baseUrl, (error, response, body) => {
			if (error) {
				this.unresolvedSites.push({ baseUrl: baseUrl, error: error })
				return cb(error);
			}
			// Check status code (200 is HTTP OK)
			if (response.statusCode !== 200) {
				return cb({ msg: "Status code NOT 200" }, null);
			}
			// Parse the document body
			var $ = cheerio.load(body);

			return cb(null, $);
		});
	}

	getImpressumLink($, baseUrl) {
		var relativeLinks = $("a[href^='/']");
		var impressumLink = '';
		try {
			var links = $($.html()).find('a');
			links.each((i, link) => {
				var tagText = '';
				if (link.type == 'tag' && link.name == 'a') {// Is an anchor
					if (link.children[0] && link.children[0].type == 'text') {// if tag has text
						tagText = link.children[0].data;
					}
					if (/impressum/i.test(link.attribs.href) || /impressum/i.test(link.attribs.title) || /impressum/i.test(tagText)) { //If the link href or title contains impressum string
						impressumLink = link.attribs.href;
					}

				}

			});

			if (impressumLink.length > 1) {//If impressum link found, check if correct url form, if not correct it
				if (impressumLink.indexOf('http') == -1 && impressumLink.indexOf('https') == -1) { //Is not fully formated, modify
					if (impressumLink.charAt(0) != '/' && baseUrl.charAt(baseUrl.length - 1) != '/') {//If slash deoe not exist add
						baseUrl = baseUrl + '/'
					}
					impressumLink = baseUrl + impressumLink;
				}

			}
			return impressumLink;
		} catch (err) {
			console.log('Could not be parsed!');
			//console.log(err);
			return '';
		}

	}

}

module.exports = CsvLoader