(function($) {
	'use strict';

	$.M = {
		app_id: "",
		applicationServerKey: "",
		receiver_url: "",
		version: "0.9",
		init: false,
		database: null,
		openLock: null,

		push: function(app_id, receiver_url, applicationServerKey, options) {
			if(!this.isPushNotificationsSupported()) return false;

			this.app_id = app_id;
			this.receiver_url = receiver_url;
			this.applicationServerKey = this._urlB64ToUint8Array(applicationServerKey);

			if(this.receiver_url.endsWith('/')) {
				this.receiver_url = this.receiver_url.substr(0, -1);
			}

			if(typeof options === "object") {
				this._putDB("Options", Object.assign({key: "options", app_id: app_id, receiver_url: receiver_url}, options));
			}

			this.init = true;

			return true;
		},
		register: function(cuid, name) { // register service and user
			if(!this.init) {
				var error = new Error("Morpheus Web Push Library doesn't initialized.");
				error.name = "UninitializedError";
				return Promise.reject(error);
			}
			if(!this.isPushNotificationsSupported()) {
				var error = new Error("Unsupported browser.");
				error.name = "UnsupportedBrowser";
				return Promise.reject(error);
			}

			var _self = this;

			return navigator.serviceWorker.register('/MPushSW.js').then(function(registration) {
				return navigator.serviceWorker.ready.then(function(registration) {
					return registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:_self.applicationServerKey}).then(function(subscription) {
						var registServiceAndUser = function(retries = 1) {
							if(retries < 0) {
								var error = new Error("Push notification registration error.");
								error.name = "RegistServiceAndUserError"
								return Promise.reject(error);
							}
							return _self._getAuthKey("TMP0"+cuid, subscription.endpoint).then(function(authkey) {
								return new Promise(function(resolve, reject) {
									var form = new FormData();
									form.append("AUTHKEY", authkey);
									form.append("APP_ID", _self.app_id);
									form.append("CUID", cuid);
									form.append("CNAME", name);
									form.append("DEVICE_ID", _self._Uint8ArrayToUrlB64(subscription.getKey('auth')));
									form.append("APP_VER", _self.version);
									form.append("PNSID", "WPNS");
									form.append("PSID", subscription.endpoint);
									form.append("PHONENUM", "");
									form.append("CBSID", "");
									form.append("APNS_MODE", "");
									form.append("P256DH", _self._Uint8ArrayToUrlB64(subscription.getKey('p256dh')));

									var xhr = new XMLHttpRequest();
									xhr.onload = function(e) {
										if(e.target.status === 200 || e.target.status === 201) {
											var response = JSON.parse(e.target.responseText);
											if(response.HEADER.RESULT_CODE === "0000") {
												return _self._putDB("Subscribe", { key: "subscribe", cuid: cuid, endpoint: subscription.endpoint }).then(() => {
													resolve(response.BODY[0]);
												}).catch(() => {
													var error = new Error("An error occurred during the processing.");
													error.name = "RegistServiceAndUserError";
													reject(error);
												});
											} else if(response.HEADER.RESULT_CODE === "40100") {
												sessionStorage.removeItem("AUTHKEY");
												return registServiceAndUser(retries-1);
											} else {
												var error = new Error(response.HEADER.RESULT_BODY);
												error.name = response.HEADER.RESULT_CODE;
												reject(error);
											}
										} else {
											var error = new Error(e.target.statusText);
											error.name = e.target.status;
											reject(error);
										}
									}
									xhr.onerror = function(e) {
										var error = new Error("An error occurred during the processing.");
										error.name = "RegistServiceAndUserError";
										reject(error);
									}
									xhr.open("POST", _self.receiver_url + "/wpns_rcv_register_service_and_user.ctl", true);
									xhr.send(form);
								});
							});
						}

						return _self._getDB("Subscribe", "endpoint").then(function(local) {
							if(local.endpoint === subscription.endpoint) {
								return Promise.resolve();
							} else {
								return registServiceAndUser();
							}
						}).catch(function(e) {
							return registServiceAndUser();
						});
					});
				}, function(error) {
					return Promise.reject(error);
				});
			});
		},
		unregisterService: async function() { // unregister service
			return this._sendIF("/rcv_delete_service.ctl").then(() => {
				navigator.serviceWorker.ready.then(function(registration) {
					registration.unregister();
				});
			});
		},
		addGroup: async function(groupname) {
			return this._sendIF("/rcv_register_usergroup.ctl", { GROUPNAME: groupname });
		},
		getGroup: async function(groupseq) {
			return this._sendIF("/rcv_get_usergroup.ctl", { GROUPSEQ: groupseq });
		},
		deleteGroup: async function(groupseq) {
			return this._sendIF("/rcv_delete_usergroup.ctl", { GROUPSEQ: groupseq });
		},
		addGroupUser: async function(groupseq) {
			return this._sendIF("/rcv_register_usergroup_user.ctl");
		},
		getGroupUser: async function(groupseq) {
			return this._sendIF("/rcv_get_usergroup_user.ctl");
		},
		deleteGroupUser: async function(groupseq) {
			return this._sendIF("/rcv_delete_usergroup_user.ctl");
		},
		_getAuthKey: function(cuid, psid) {
			if(sessionStorage.getItem("AUTHKEY")) {
				return Promise.resolve(sessionStorage.getItem("AUTHKEY"));
			}

			var _self = this;
			return new Promise(function(resolve, reject) {
				var form = new FormData();
				form.append("APP_ID", _self.app_id);
				form.append("CUID", cuid);
				form.append("PSID", psid);

				var xhr = new XMLHttpRequest();
				xhr.onload = function(e) {
					if(e.target.status === 200 || e.target.status === 201) {
						var response = JSON.parse(e.target.responseText);
						if(response.HEADER.RESULT_CODE === "0000") {
							sessionStorage.setItem("AUTHKEY", response.BODY[0].AUTHKEY);
							resolve(response.BODY[0].AUTHKEY);
						} else {
							var error = new Error(response.HEADER.RESULT_BODY);
							error.name = response.HEADER.RESULT_CODE;
							reject(error);
						}
					} else {
						var error = new Error(e.target.statusText);
						error.name = e.target.status;
						reject(error);
					}
				}
				xhr.onerror = function(e) {
					var error = new Error("An error occurred during the processing.");
					error.name = "AskingAuthorizationError";
					reject(error);
				}
				xhr.open("POST", _self.receiver_url + "/asking_authorization.ctl", true);
				xhr.send(form);
			});
		},
		_sendIF: async function(URI, params = {}) {
			if(!this.init) {
				var error = new Error("Morpheus Web Push Library doesn't initialized.");
				error.name = "UninitializedError";
				return Promise.reject(error);
			}

			if(!this.isPushNotificationsSupported()) {
				var error = new Error("Unsupported browser.");
				error.name = "UnsupportedBrowser";
				return Promise.reject(error);
			}

			var _self = this;

			return new Promise(function(resolve, reject) {
				navigator.serviceWorker.ready.then(function(registration) {
					registration.pushManager.getSubscription().then(async function(subscription) {
						if(URI !== "/wpns_rcv_register_service_and_user.ctl") {
							try {
								var result = await _self._getDB("Subscribe", "subscribe");
								params.CUID = result.cuid;
							} catch(e) {
								return Promise.reject(e);
							}
						}

						params.PSID = subscription.endpoint;
						params.DEVICE_ID = _self._Uint8ArrayToUrlB64(subscription.getKey('auth'));

						// Call I/F
						var callIF = function(retries = 1) {
							if(retries < 0) {
								var error = new Error("Error occurred while adding new group.");
								error.name = "AddGroupError"
								return Promise.reject(error);
							}
							return _self._getAuthKey(((URI !== "/wpns_rcv_register_service_and_user.ctl") ? params.CUID : "TMP0"+params.CUID), params.PSID).then(function(authkey) {
								return new Promise(function(resolve, reject) {
									var form = new FormData();
									form.append("APP_ID", _self.app_id);
									form.append("AUTHKEY", authkey);
									form.append("PNSID", "WPNS");
									form.append("PHONENUM", "");

									if(typeof params !== 'undefined') {
										for(var k in params) {
											form.append(k, params[k]);
										}
									}

									var xhr = new XMLHttpRequest();
									xhr.onload = function(e) {
										if(e.target.status === 200 || e.target.status === 201) {
											var response = JSON.parse(e.target.responseText);
											if(response.HEADER.RESULT_CODE === "0000") {
												resolve(response.BODY);
											} else if(response.HEADER.RESULT_CODE === "40100") {
												sessionStorage.removeItem("AUTHKEY");
												return addgroup(retries-1);
											} else {
												var error = new Error(response.HEADER.RESULT_BODY);
												error.name = response.HEADER.RESULT_CODE;
												reject(error);
											}
										} else {
											var error = new Error(e.target.statusText);
											error.name = e.target.status;
											reject(error);
										}
									}
									xhr.onerror = function(e) {
										var error = new Error("An error occurred during the processing.");
										error.name = "UPMCAPIRequestError";
										reject(error);
									}
									xhr.open("POST", _self.receiver_url + URI, true);
									xhr.send(form);
								});
							});
						};
						callIF().then(function(response) {
							resolve(response);
						}).catch(function(e) {
							reject(e);
						});
					}).catch(function(e) {
						reject(e);
					});
				}).catch(function(e) {
					reject(e);
				});
			});
		},
		_openDB: function(dbName) {
			return new Promise((resolve, reject) => {
				try {
					var request = $.indexedDB.open(dbName, 1);
				} catch(e) {
				}

				if(!request) {
					return null;
				}
				request.onupgradeneeded = () => {
					request.result.createObjectStore("Subscribe", {keyPath:"key"});
					request.result.createObjectStore("Options", {keyPath:"key"});
				};
				request.onsuccess = () => {
					this.database = request.result;
					this.database.onversionchange = function() {
					}

					resolve(this.database);
				};
			});
		},
		_ensureDBOpen: async function() {
			if(!this.openLock) {
				this.openLock = this._openDB("MPush");
			}
			await this.openLock;
			return this.database;
		},
		_getDB: async function(table, key) {
			await this._ensureDBOpen();
			return new Promise((resolve, reject) => {
				var request = this.database.transaction(table).objectStore(table).get(key);
				request.onsuccess = () => {
					resolve(request.result);
				};
				request.onerror = () => {
					reject(request.error);
				};
			});
		},
		_putDB: async function(table, key) {
			await this._ensureDBOpen();
			return new Promise((resolve, reject) => {
				try {
					var request = this.database.transaction(table, 'readwrite').objectStore(table).put(key);
					request.onsuccess = () => {
						resolve(key);
					};
					request.onerror = (e) => {
						reject(e);
					};
				} catch(e) {
				}
			});
		},
		isPushNotificationsSupported: function() {
			if (typeof window.Promise === "undefined") {
				return false;
			}

			var browser = this._redetectBrowserUserAgent();
			var userAgent = navigator.userAgent || '';

			if(!browser.safari && !('serviceWorker' in navigator && 'PushManager' in window)) {
				return false;
			}

			if(browser.ios || browser.ipod || browser.iphone || browser.ipad)
				return false;

			if(browser.msie || browser.msedge)
				return false;

			// Facebook in-app browser
			if(userAgent.indexOf("FBAN") > -1 || userAgent.indexOf("FBAV") > -1) {
				return false;
			}

			// Android Chrome WebView
			if(navigator.appVersion.match(/ wv/))
				return false;

			if(browser.firefox && Number(browser.version) >= 44)
				return true;

			if(browser.safari)
				return false;

			// Samsung Internet - Android 4.0+
			if(browser.samsungBrowser && Number(browser.version) >= 4) {
				return true;
			}

			if((browser.chrome || browser.chromium) && Number(browser.version) >= 42)
				return true;

			return false;
		},
		_redetectBrowserUserAgent: function() {
			if(this.bowser.name === '' && this.bowser.version === '') {
				var browser = this.bowser._detect(navigator.userAgent);
			} else {
				var browser = this.bowser;
			}
			
			return browser;
		},
		_urlB64ToUint8Array: function(base64String) {
		  const padding = '='.repeat((4 - base64String.length % 4) % 4);
		  const base64 = (base64String + padding)
		    .replace(/\-/g, '+')
		    .replace(/_/g, '/');

		  const rawData = window.atob(base64);
		  const outputArray = new Uint8Array(rawData.length);

		  for (let i = 0; i < rawData.length; ++i) {
		    outputArray[i] = rawData.charCodeAt(i);
		  }
		  return outputArray;
		},
		_Uint8ArrayToUrlB64: function(uint8Array) {
			return btoa(String.fromCharCode.apply(null, new Uint8Array(uint8Array))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
		},
		bowser: (function () {
		  var t = true

		  function detect(ua) {

		    function getFirstMatch(regex) {
		      var match = ua.match(regex);
		      return (match && match.length > 1 && match[1]) || '';
		    }

		    function getSecondMatch(regex) {
		      var match = ua.match(regex);
		      return (match && match.length > 1 && match[2]) || '';
		    }

		    var iosdevice = getFirstMatch(/(ipod|iphone|ipad)/i).toLowerCase()
		      , likeAndroid = /like android/i.test(ua)
		      , android = !likeAndroid && /android/i.test(ua)
		      , nexusMobile = /nexus\s*[0-6]\s*/i.test(ua)
		      , nexusTablet = !nexusMobile && /nexus\s*[0-9]+/i.test(ua)
		      , chromeos = /CrOS/.test(ua)
		      , silk = /silk/i.test(ua)
		      , sailfish = /sailfish/i.test(ua)
		      , tizen = /tizen/i.test(ua)
		      , webos = /(web|hpw)os/i.test(ua)
		      , windowsphone = /windows phone/i.test(ua)
		      , samsungBrowser = /SamsungBrowser/i.test(ua)
		      , windows = !windowsphone && /windows/i.test(ua)
		      , mac = !iosdevice && !silk && /macintosh/i.test(ua)
		      , linux = !android && !sailfish && !tizen && !webos && /linux/i.test(ua)
		      , edgeVersion = getSecondMatch(/edg([ea]|ios)\/(\d+(\.\d+)?)/i)
		      , versionIdentifier = getFirstMatch(/version\/(\d+(\.\d+)?)/i)
		      , tablet = /tablet/i.test(ua) && !/tablet pc/i.test(ua)
		      , mobile = !tablet && /[^-]mobi/i.test(ua)
		      , xbox = /xbox/i.test(ua)
		      , result

		    if (/opera/i.test(ua)) {
		      //  an old Opera
		      result = {
		        name: 'Opera'
		      , opera: t
		      , version: versionIdentifier || getFirstMatch(/(?:opera|opr|opios)[\s\/](\d+(\.\d+)?)/i)
		      }
		    } else if (/opr\/|opios/i.test(ua)) {
		      // a new Opera
		      result = {
		        name: 'Opera'
		        , opera: t
		        , version: getFirstMatch(/(?:opr|opios)[\s\/](\d+(\.\d+)?)/i) || versionIdentifier
		      }
		    }
		    else if (/SamsungBrowser/i.test(ua)) {
		      result = {
		        name: 'Samsung Internet for Android'
		        , samsungBrowser: t
		        , version: versionIdentifier || getFirstMatch(/(?:SamsungBrowser)[\s\/](\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/coast/i.test(ua)) {
		      result = {
		        name: 'Opera Coast'
		        , coast: t
		        , version: versionIdentifier || getFirstMatch(/(?:coast)[\s\/](\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/yabrowser/i.test(ua)) {
		      result = {
		        name: 'Yandex Browser'
		      , yandexbrowser: t
		      , version: versionIdentifier || getFirstMatch(/(?:yabrowser)[\s\/](\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/ucbrowser/i.test(ua)) {
		      result = {
		          name: 'UC Browser'
		        , ucbrowser: t
		        , version: getFirstMatch(/(?:ucbrowser)[\s\/](\d+(?:\.\d+)+)/i)
		      }
		    }
		    else if (/mxios/i.test(ua)) {
		      result = {
		        name: 'Maxthon'
		        , maxthon: t
		        , version: getFirstMatch(/(?:mxios)[\s\/](\d+(?:\.\d+)+)/i)
		      }
		    }
		    else if (/epiphany/i.test(ua)) {
		      result = {
		        name: 'Epiphany'
		        , epiphany: t
		        , version: getFirstMatch(/(?:epiphany)[\s\/](\d+(?:\.\d+)+)/i)
		      }
		    }
		    else if (/puffin/i.test(ua)) {
		      result = {
		        name: 'Puffin'
		        , puffin: t
		        , version: getFirstMatch(/(?:puffin)[\s\/](\d+(?:\.\d+)?)/i)
		      }
		    }
		    else if (/sleipnir/i.test(ua)) {
		      result = {
		        name: 'Sleipnir'
		        , sleipnir: t
		        , version: getFirstMatch(/(?:sleipnir)[\s\/](\d+(?:\.\d+)+)/i)
		      }
		    }
		    else if (/k-meleon/i.test(ua)) {
		      result = {
		        name: 'K-Meleon'
		        , kMeleon: t
		        , version: getFirstMatch(/(?:k-meleon)[\s\/](\d+(?:\.\d+)+)/i)
		      }
		    }
		    else if (windowsphone) {
		      result = {
		        name: 'Windows Phone'
		      , osname: 'Windows Phone'
		      , windowsphone: t
		      }
		      if (edgeVersion) {
		        result.msedge = t
		        result.version = edgeVersion
		      }
		      else {
		        result.msie = t
		        result.version = getFirstMatch(/iemobile\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/msie|trident/i.test(ua)) {
		      result = {
		        name: 'Internet Explorer'
		      , msie: t
		      , version: getFirstMatch(/(?:msie |rv:)(\d+(\.\d+)?)/i)
		      }
		    } else if (chromeos) {
		      result = {
		        name: 'Chrome'
		      , osname: 'Chrome OS'
		      , chromeos: t
		      , chromeBook: t
		      , chrome: t
		      , version: getFirstMatch(/(?:chrome|crios|crmo)\/(\d+(\.\d+)?)/i)
		      }
		    } else if (/edg([ea]|ios)/i.test(ua)) {
		      result = {
		        name: 'Microsoft Edge'
		      , msedge: t
		      , version: edgeVersion
		      }
		    }
		    else if (/vivaldi/i.test(ua)) {
		      result = {
		        name: 'Vivaldi'
		        , vivaldi: t
		        , version: getFirstMatch(/vivaldi\/(\d+(\.\d+)?)/i) || versionIdentifier
		      }
		    }
		    else if (sailfish) {
		      result = {
		        name: 'Sailfish'
		      , osname: 'Sailfish OS'
		      , sailfish: t
		      , version: getFirstMatch(/sailfish\s?browser\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/seamonkey\//i.test(ua)) {
		      result = {
		        name: 'SeaMonkey'
		      , seamonkey: t
		      , version: getFirstMatch(/seamonkey\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/firefox|iceweasel|fxios/i.test(ua)) {
		      result = {
		        name: 'Firefox'
		      , firefox: t
		      , version: getFirstMatch(/(?:firefox|iceweasel|fxios)[ \/](\d+(\.\d+)?)/i)
		      }
		      if (/\((mobile|tablet);[^\)]*rv:[\d\.]+\)/i.test(ua)) {
		        result.firefoxos = t
		        result.osname = 'Firefox OS'
		      }
		    }
		    else if (silk) {
		      result =  {
		        name: 'Amazon Silk'
		      , silk: t
		      , version : getFirstMatch(/silk\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/phantom/i.test(ua)) {
		      result = {
		        name: 'PhantomJS'
		      , phantom: t
		      , version: getFirstMatch(/phantomjs\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/slimerjs/i.test(ua)) {
		      result = {
		        name: 'SlimerJS'
		        , slimer: t
		        , version: getFirstMatch(/slimerjs\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (/blackberry|\bbb\d+/i.test(ua) || /rim\stablet/i.test(ua)) {
		      result = {
		        name: 'BlackBerry'
		      , osname: 'BlackBerry OS'
		      , blackberry: t
		      , version: versionIdentifier || getFirstMatch(/blackberry[\d]+\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (webos) {
		      result = {
		        name: 'WebOS'
		      , osname: 'WebOS'
		      , webos: t
		      , version: versionIdentifier || getFirstMatch(/w(?:eb)?osbrowser\/(\d+(\.\d+)?)/i)
		      };
		      /touchpad\//i.test(ua) && (result.touchpad = t)
		    }
		    else if (/bada/i.test(ua)) {
		      result = {
		        name: 'Bada'
		      , osname: 'Bada'
		      , bada: t
		      , version: getFirstMatch(/dolfin\/(\d+(\.\d+)?)/i)
		      };
		    }
		    else if (tizen) {
		      result = {
		        name: 'Tizen'
		      , osname: 'Tizen'
		      , tizen: t
		      , version: getFirstMatch(/(?:tizen\s?)?browser\/(\d+(\.\d+)?)/i) || versionIdentifier
		      };
		    }
		    else if (/qupzilla/i.test(ua)) {
		      result = {
		        name: 'QupZilla'
		        , qupzilla: t
		        , version: getFirstMatch(/(?:qupzilla)[\s\/](\d+(?:\.\d+)+)/i) || versionIdentifier
		      }
		    }
		    else if (/chromium/i.test(ua)) {
		      result = {
		        name: 'Chromium'
		        , chromium: t
		        , version: getFirstMatch(/(?:chromium)[\s\/](\d+(?:\.\d+)?)/i) || versionIdentifier
		      }
		    }
		    else if (/chrome|crios|crmo/i.test(ua)) {
		      result = {
		        name: 'Chrome'
		        , chrome: t
		        , version: getFirstMatch(/(?:chrome|crios|crmo)\/(\d+(\.\d+)?)/i)
		      }
		    }
		    else if (android) {
		      result = {
		        name: 'Android'
		        , version: versionIdentifier
		      }
		    }
		    else if (/safari|applewebkit/i.test(ua)) {
		      result = {
		        name: 'Safari'
		      , safari: t
		      }
		      if (versionIdentifier) {
		        result.version = versionIdentifier
		      }
		    }
		    else if (iosdevice) {
		      result = {
		        name : iosdevice == 'iphone' ? 'iPhone' : iosdevice == 'ipad' ? 'iPad' : 'iPod'
		      }
		      if (versionIdentifier) {
		        result.version = versionIdentifier
		      }
		    }
		    else if(/googlebot/i.test(ua)) {
		      result = {
		        name: 'Googlebot'
		      , googlebot: t
		      , version: getFirstMatch(/googlebot\/(\d+(\.\d+))/i) || versionIdentifier
		      }
		    }
		    else {
		      result = {
		        name: getFirstMatch(/^(.*)\/(.*) /),
		        version: getSecondMatch(/^(.*)\/(.*) /)
		     };
		   }

		    if (!result.msedge && /(apple)?webkit/i.test(ua)) {
		      if (/(apple)?webkit\/537\.36/i.test(ua)) {
		        result.name = result.name || "Blink"
		        result.blink = t
		      } else {
		        result.name = result.name || "Webkit"
		        result.webkit = t
		      }
		      if (!result.version && versionIdentifier) {
		        result.version = versionIdentifier
		      }
		    } else if (!result.opera && /gecko\//i.test(ua)) {
		      result.name = result.name || "Gecko"
		      result.gecko = t
		      result.version = result.version || getFirstMatch(/gecko\/(\d+(\.\d+)?)/i)
		    }

		    if (!result.windowsphone && (android || result.silk)) {
		      result.android = t
		      result.osname = 'Android'
		    } else if (!result.windowsphone && iosdevice) {
		      result[iosdevice] = t
		      result.ios = t
		      result.osname = 'iOS'
		    } else if (mac) {
		      result.mac = t
		      result.osname = 'macOS'
		    } else if (xbox) {
		      result.xbox = t
		      result.osname = 'Xbox'
		    } else if (windows) {
		      result.windows = t
		      result.osname = 'Windows'
		    } else if (linux) {
		      result.linux = t
		      result.osname = 'Linux'
		    }

		    function getWindowsVersion (s) {
		      switch (s) {
		        case 'NT': return 'NT'
		        case 'XP': return 'XP'
		        case 'NT 5.0': return '2000'
		        case 'NT 5.1': return 'XP'
		        case 'NT 5.2': return '2003'
		        case 'NT 6.0': return 'Vista'
		        case 'NT 6.1': return '7'
		        case 'NT 6.2': return '8'
		        case 'NT 6.3': return '8.1'
		        case 'NT 10.0': return '10'
		        default: return undefined
		      }
		    }

		    var osVersion = '';
		    if (result.windows) {
		      osVersion = getWindowsVersion(getFirstMatch(/Windows ((NT|XP)( \d\d?.\d)?)/i))
		    } else if (result.windowsphone) {
		      osVersion = getFirstMatch(/windows phone (?:os)?\s?(\d+(\.\d+)*)/i);
		    } else if (result.mac) {
		      osVersion = getFirstMatch(/Mac OS X (\d+([_\.\s]\d+)*)/i);
		      osVersion = osVersion.replace(/[_\s]/g, '.');
		    } else if (iosdevice) {
		      osVersion = getFirstMatch(/os (\d+([_\s]\d+)*) like mac os x/i);
		      osVersion = osVersion.replace(/[_\s]/g, '.');
		    } else if (android) {
		      osVersion = getFirstMatch(/android[ \/-](\d+(\.\d+)*)/i);
		    } else if (result.webos) {
		      osVersion = getFirstMatch(/(?:web|hpw)os\/(\d+(\.\d+)*)/i);
		    } else if (result.blackberry) {
		      osVersion = getFirstMatch(/rim\stablet\sos\s(\d+(\.\d+)*)/i);
		    } else if (result.bada) {
		      osVersion = getFirstMatch(/bada\/(\d+(\.\d+)*)/i);
		    } else if (result.tizen) {
		      osVersion = getFirstMatch(/tizen[\/\s](\d+(\.\d+)*)/i);
		    }
		    if (osVersion) {
		      result.osversion = osVersion;
		    }

		    var osMajorVersion = !result.windows && osVersion.split('.')[0];
		    if (
		         tablet
		      || nexusTablet
		      || iosdevice == 'ipad'
		      || (android && (osMajorVersion == 3 || (osMajorVersion >= 4 && !mobile)))
		      || result.silk
		    ) {
		      result.tablet = t
		    } else if (
		         mobile
		      || iosdevice == 'iphone'
		      || iosdevice == 'ipod'
		      || android
		      || nexusMobile
		      || result.blackberry
		      || result.webos
		      || result.bada
		    ) {
		      result.mobile = t
		    }

		    if (result.msedge ||
		        (result.msie && result.version >= 10) ||
		        (result.yandexbrowser && result.version >= 15) ||
				    (result.vivaldi && result.version >= 1.0) ||
		        (result.chrome && result.version >= 20) ||
		        (result.samsungBrowser && result.version >= 4) ||
		        (result.firefox && result.version >= 20.0) ||
		        (result.safari && result.version >= 6) ||
		        (result.opera && result.version >= 10.0) ||
		        (result.ios && result.osversion && result.osversion.split(".")[0] >= 6) ||
		        (result.blackberry && result.version >= 10.1)
		        || (result.chromium && result.version >= 20)
		        ) {
		      result.a = t;
		    }
		    else if ((result.msie && result.version < 10) ||
		        (result.chrome && result.version < 20) ||
		        (result.firefox && result.version < 20.0) ||
		        (result.safari && result.version < 6) ||
		        (result.opera && result.version < 10.0) ||
		        (result.ios && result.osversion && result.osversion.split(".")[0] < 6)
		        || (result.chromium && result.version < 20)
		        ) {
		      result.c = t
		    } else result.x = t

		    return result
		  }

		  var bowser = detect(typeof navigator !== 'undefined' ? navigator.userAgent || '' : '')

		  bowser.test = function (browserList) {
		    for (var i = 0; i < browserList.length; ++i) {
		      var browserItem = browserList[i];
		      if (typeof browserItem=== 'string') {
		        if (browserItem in bowser) {
		          return true;
		        }
		      }
		    }
		    return false;
		  }

		  function getVersionPrecision(version) {
		    return version.split(".").length;
		  }

		  function map(arr, iterator) {
		    var result = [], i;
		    if (Array.prototype.map) {
		      return Array.prototype.map.call(arr, iterator);
		    }
		    for (i = 0; i < arr.length; i++) {
		      result.push(iterator(arr[i]));
		    }
		    return result;
		  }

		  function compareVersions(versions) {
		    // 1) get common precision for both versions, for example for "10.0" and "9" it should be 2
		    var precision = Math.max(getVersionPrecision(versions[0]), getVersionPrecision(versions[1]));
		    var chunks = map(versions, function (version) {
		      var delta = precision - getVersionPrecision(version);

		      // 2) "9" -> "9.0" (for precision = 2)
		      version = version + new Array(delta + 1).join(".0");

		      // 3) "9.0" -> ["000000000"", "000000009"]
		      return map(version.split("."), function (chunk) {
		        return new Array(20 - chunk.length).join("0") + chunk;
		      }).reverse();
		    });

		    // iterate in reverse order by reversed chunks array
		    while (--precision >= 0) {
		      // 4) compare: "000000009" > "000000010" = false (but "9" > "10" = true)
		      if (chunks[0][precision] > chunks[1][precision]) {
		        return 1;
		      }
		      else if (chunks[0][precision] === chunks[1][precision]) {
		        if (precision === 0) {
		          // all version chunks are same
		          return 0;
		        }
		      }
		      else {
		        return -1;
		      }
		    }
		  }

		  function isUnsupportedBrowser(minVersions, strictMode, ua) {
		    var _bowser = bowser;

		    // make strictMode param optional with ua param usage
		    if (typeof strictMode === 'string') {
		      ua = strictMode;
		      strictMode = void(0);
		    }

		    if (strictMode === void(0)) {
		      strictMode = false;
		    }
		    if (ua) {
		      _bowser = detect(ua);
		    }

		    var version = "" + _bowser.version;
		    for (var browser in minVersions) {
		      if (minVersions.hasOwnProperty(browser)) {
		        if (_bowser[browser]) {
		          if (typeof minVersions[browser] !== 'string') {
		            throw new Error('Browser version in the minVersion map should be a string: ' + browser + ': ' + String(minVersions));
		          }
		          return compareVersions([version, minVersions[browser]]) < 0;
		        }
		      }
		    }

		    return strictMode; // not found
		  }

		  function check(minVersions, strictMode, ua) {
		    return !isUnsupportedBrowser(minVersions, strictMode, ua);
		  }

		  bowser.isUnsupportedBrowser = isUnsupportedBrowser;
		  bowser.compareVersions = compareVersions;
		  bowser.check = check;
		  bowser._detect = detect;
		  bowser.detect = detect;
		  return bowser
		})()
	}
})(window);
