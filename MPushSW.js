var ServiceWorker = {
	onServiceWorkerInstalled: function(event) {
		event.waitUntil(self.skipWaiting());
	},

	onServiceWorkerActivated: function(event) {
    event.waitUntil(self.clients.claim());
	},

	onPush: function(event) {
		var payload = event.data.json();

		event.waitUntil(async function(){
			try {
				await ServiceWorker.sendIF('/rcv_register_sent_ack.ctl', { SEQNO: payload.mps.seqno }).catch(function(e) { console.log(e); });

				var json = JSON.parse(payload.aps.alert);
				var message = {};
				var title = json.title || '';

				if(json.hasOwnProperty('body')) {
					message.body = json.body;
				}
				message.data = payload;

				return DB.get("Options", "options").then((local) => {
					if(json.hasOwnProperty('icon')) {
						message.icon = json.icon;
					} else if(local.hasOwnProperty("icon")) {
						message.icon = local.icon;
					}

					return self.registration.showNotification(title, message);
				});
			} catch(e) {
				return DB.get("Options", "options").then((local) => {
					var message = {};
					var title = local.title || '';

					if(local.hasOwnProperty('icon')) {
						message.icon = local.icon;
					}

					message.body = payload.aps.alert;
					message.data = payload;

					return self.registration.showNotification(title, message);
				});
			}
		}());
	},

	onNotificationClicked: function(event) {
		event.waitUntil(async function() {
			var option = await DB.get("Options", "options").catch(function(e) {}) || {};
			var launchUrl = option.url || self.registration.scope;
			var seqno = event.notification.data.mps.seqno;

			event.notification.close();

			if(event.notification.data) {
				try {
					var json = JSON.parse(event.notification.data.aps.alert);
					if(json.hasOwnProperty('url')) {
						launchUrl = json.url;
					}
				} catch(e) {
				}
			}

			clients.openWindow(launchUrl);

			// Send Read to UPMC
			ServiceWorker.sendIF('/rcv_register_send_result.ctl', { SEQNO: seqno }).catch(function(e) {});
		}());
	},

	run: function() {
		self.addEventListener('install', ServiceWorker.onServiceWorkerInstalled);
		self.addEventListener('activate', ServiceWorker.onServiceWorkerActivated);
		self.addEventListener('push', ServiceWorker.onPush);
		self.addEventListener('notificationclick', ServiceWorker.onNotificationClicked);
	},

	getAuthKey: async function() {
		var _self = this;
		var sendAuthKeyIF = function() {
			return new Promise(function(resolve, reject) {
				_self.sendIF("/asking_authorization.ctl").then(function(response) {
					DB.put("Subscribe", { key: "authkey", created: Math.floor(Date.now()/1000), authkey: response.BODY[0].AUTHKEY });
					resolve(response.BODY[0].AUTHKEY);
				}).catch(function(e) {
					reject(e);
				})
			});
		};

		return new Promise(function(resolve, reject) {
			DB.get("Subscribe", "authkey").then(function(result) {
				if((result.created+3600) > Math.floor(Date.now()/1000)) {
					sendAuthKeyIF().then(function(authkey) {
						resolve(authkey);
					});
				} else {
					resolve(result.authkey);
				}
			}).catch(function(e) {
				if(e.name === 'UndefinedKey') {
					sendAuthKeyIF().then(function(authkey) {
						resolve(authkey);
					});
				} else {
					reject(e);
				}
			});
		});
	},

	sendIF: async function(url, param = null) {
		var _self = this;

		return Promise.all([DB.get("Subscribe", "subscribe"), DB.get("Options", "options")]).then((values) => {
			var local = Object.assign(values[0], values[1]);

			var form = new FormData();

			if(typeof param !== 'undefined') {
				for(var k in param) {
					form.append(k, param[k]);
				}
			}

			form.append("APP_ID", local.app_id);
			form.append("CUID", local.cuid);
			form.append("PSID", local.endpoint);
			form.append("PNSID", "WPNS");

			return fetch(local.receiver_url + url, {
				mode: 'cors',
				method: 'POST',
				cache: 'default',
				body: form
			}).then(function(response) {
				return response.json();
			});
		});
	}
};

var DB = {
	database: null,
	openLock: null,
	_openDB: function(dbName) {
		return new Promise((resolve, reject) => {
			try {
				var request = indexedDB.open(dbName, 1);
			} catch(e) {
			}

			if(!request) {
				return null;
			}

			request.onsuccess = () => {
				this.database = request.result;

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
	get: async function(table, key) {
		await this._ensureDBOpen();
		return new Promise((resolve, reject) => {
			var request = this.database.transaction(table).objectStore(table).get(key);
			request.onsuccess = () => {
				if(typeof request.result === 'undefined') {
					var error = new Error("undefined key.");
					error.name = "UndefinedKey";
					reject(error);
				} else {
					resolve(request.result);
				}
			};
			request.onerror = () => {
				reject(request.error);
			};
		});
	},
	put: async function(table, key) {
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
	}
};

if (typeof self === "undefined" && typeof global !== "undefined") {
  global.MPushWorker = ServiceWorker;
} else {
  self.MPushWorker = ServiceWorker;
}

if(typeof self !== 'undefined') {
	MPushWorker.run();
}