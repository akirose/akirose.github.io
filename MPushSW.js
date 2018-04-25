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
				var json = JSON.parse(payload.aps.alert);
				var message = {};
				var title = json.title || '';

				if(json.hasOwnProperty('body')) {
					message.body = json.body;
				}
				message.data = payload;

				DB.get("Options", "options").then((local) => {
					if(json.hasOwnProperty('icon')) {
						message.icon = json.icon;
					} else if(local.hasOwnProperty("icon")) {
						message.icon = local.icon;
					}

					self.registration.showNotification(title, message);
				});
			} catch(e) {
				DB.get("Options", "options").then((local) => {
					var message = {};
					var title = local.title || '';

					if(local.hasOwnProperty('icon')) {
						message.icon = local.icon;
					}

					message.body = payload.aps.alert;
					message.data = payload;

					self.registration.showNotification(title, message);
				});
			}

			// Send ACK to UPMC
			ServiceWorker.sendIF('/rcv_register_sent_ack.ctl', { SEQNO: payload.mps.seqno }).catch(function(e) {});
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

	sendIF: function(url, param = null) {
		return Promise.all([DB.get("Subscribe", "subscribe"), DB.get("Options", "options"), self.registration.pushManager.getSubscription()]).then((values) => {
			var local = Object.assign(values[0], values[1]);
			var subscription = values[2];

			var form = new FormData();

			if(typeof param !== 'undefined') {
				for(var k in param) {
					form.append(k, param[k]);
				}
			}

			form.append("APP_ID", local.app_id);
			form.append("CUID", local.cuid);
			form.append("PSID", subscription.endpoint);
			form.append("DEVICE_ID", subscription.getKey('auth'));
			form.append("PNSID", "WPNS");

			return fetch(local.receiver_url + url, {
				mode: 'cors',
				method: 'POST',
				cache: 'default',
				body: form
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
	}
};

if (typeof self === "undefined" &&
    typeof global !== "undefined") {
  global.MPushWorker = ServiceWorker;
} else {
  self.MPushWorker = ServiceWorker;
}

console.log(typeof self);
if(typeof self !== 'undefined') {
	console.log("Morpheus PUSH ServiceWorker running.");
	MPushWorker.run();
}