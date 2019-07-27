(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but 
        // only CommonJS-like environments that support module.exports, 
        // like Node. 
        module.exports = factory();
    } else {
        // Browser globals (root is window) 
        root.jIDBAdapter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    /**
     * 
     * @param {*} config 
     * @param {*} CB 
     */
    function indexedDBStorage(config, CB) {
        var publicApis = {},
            dbName = "_jEliDB_",
            _storeName = '_jEli_DB_Store_',
            _version = 1,
            _db,
            _privateStore = {};

        /**
         * 
         * @param {*} version 
         * @param {*} onUpgradeneeded 
         */
        function createDB(version, onUpgradeneeded) {
            // set the reference to our latest version
            _version = version || _version;
            var req = window.indexedDB.open(dbName, _version);

            req.onsuccess = function(evt) {
                _db = this.result;

                getAllStoreData((CB || noop))
            };

            req.onerror = function(evt) {
                console.error("jEliDB:indexedDB:Error:", evt.target.errorCode);
            };

            req.onupgradeneeded = onUpgradeneeded || noop;
        }


        // create our DB with the default version
        createDB(config.version, function(ev) {
            var db = ev.target.result;
            // Create an objectStore to hold information . We're
            // going to use "ssn" as our key path because it's guaranteed to be
            // unique - or at least that's what I was told during the kickoff meeting.
            db.createObjectStore(_storeName, { keyPath: "_rev" });
        });


        function getAllStoreData(resolve) {
            var store = getObjectStore(_storeName, "readwrite"),
                req = store.openCursor();

            req.onsuccess = function(evt) {
                var cursor = evt.target.result;
                // If the cursor is pointing at something, ask for the data
                if (cursor) {
                    // get our data and append to our local store for quick query
                    req = store.get(cursor.key);
                    req.onsuccess = function(evt) {
                        var value = evt.target.result;
                        _privateStore[cursor.key] = value._data;
                    };

                    // Move on to the next object in store
                    cursor.continue();

                } else {
                    resolve();
                }
            };
        }

        function indexedDbPrivateApi() {
            this.checkStoreName = function(storeName) {
                return _db.objectStoreNames.contains(storeName);
            };

            this.addStore = function(storeName, data) {
                if (this.checkStoreName(_storeName)) {

                    // Use transaction oncomplete to make sure the objectStore creation is 
                    // finished before adding data into it.
                    var store = getObjectStore(_storeName, "readwrite");
                    // Store values in the newly created objectStore.
                    store.put({
                        _rev: storeName,
                        _data: data
                    });
                    // update cache
                    _privateStore[storeName] = data;
                }

                return this;
            };

            this.deleteFromStore = function(storeName, CB) {
                try {
                    var store = getObjectStore(_storeName, 'readwrite');
                    var req = store.delete(storeName);
                    req.onsuccess = CB || noop;
                } catch (e) {}
            };

            this.clearStore = function(cb) {
                try {
                    var store = getObjectStore(_storeName, 'readwrite');
                    var req = store.clear();
                    req.onsuccess = cb || noop;
                } catch (e) {

                }
            };

            this.getStoreItem = function(rev, CB) {
                var store = getObjectStore(_storeName, 'readonly'),
                    req = store.get(rev);
                req.onsuccess = CB(req);
            };
        }

        var _pApis = new indexedDbPrivateApi();

        /**
         * subscribe to storage event
         */
        indexedDBStorage.privateApi.storageEventHandler
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'insert'), function(tableName, data, insertData) {
                _privateStore[tableName].lastInsertId += data.length;
                if (insertData) {
                    _privateStore[tableName + ":data"].push.apply(_privateStore[tableName + ":data"], data);
                }
                saveData(tableName);
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'update'), saveData)
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'delete'), function(tableName) {
                saveData(tableName);
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onCreateTable'), createTable)
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(dbName, 'onAlterTable'), saveData)
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onDropTable'), function(tbl) {
                publicApis.removeItem(tbl);
                publicApis.removeItem(tbl + ":data");
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onUpdateTable'), function(tbl, updates) {
                Object.keys(updates)
                    .forEach(function(key) {
                        _privateStore[tbl][key] = updates[key];
                    });
                // set the property to db
                publicApis.setItem(tbl, _privateStore[tbl]);
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onTruncateTable'), saveData)
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onResolveSchema'), function(version, tables) {
                publicApis.setItem('version', version);
                Object.keys(tables).forEach(function(key) {
                    createTable(key, tables[key]);
                });
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onRenameTable'), function(oldTable, newTable, cb) {
                _privateStore[oldTable].TBL_NAME = newTable;
                publicApi.setItem(newTable, _privateStore[oldTable]);
                publicApi.setItem(newTable + ":data", _privateStore[oldTable + ":data"]);
                publicApi.removeItem(oldTable);
                publicApi.removeItem(oldTable + ":data");
                (cb || noop)();
            })
            .subscribe(indexedDBStorage.privateApi.eventNamingIndex(config.name, 'onRenameDataBase'), function(oldName, newName, cb) {
                var oldData = this.getItem(oldName);
                Object.keys(oldData.tables).forEach(function(tbl) {
                    oldData.tables[tbl].DB_NAME = newName;
                    oldData.tables[tbl].lastModified = +new Date
                });
                this.setItem(newName, oldData);
                this.setItem(indexedDBStorage.privateApi.storeMapping.resourceName, this.getItem(indexedDBStorage.privateApi.storeMapping.resourceName));
                indexedDBStorage.privateApi.$getActiveDB(oldName).$get('recordResolvers').rename(newName);
                this.removeItem(oldName);
                (cb || noop)();
            });


        function createTable(tableName, definition) {
            // create a new store for data
            publicApis.setItem(tableName + ":data", []);
            publicApis.setItem(tableName, definition);
        }

        function saveData(tableName) {
            publicApis.setItem(tableName + ":data", _privateStore[tableName + ":data"]);
        }

        /**
         * @param {string} store_name
         * @param {string} mode either "readonly" or "readwrite"
         */
        function getObjectStore(store_name, mode) {
            var tx = _db.transaction(store_name, mode);
            return tx.objectStore(store_name);
        }

        /**
         * 
         * @param {*} name 
         * @param {*} item 
         */
        publicApis.setItem = function(name, item) {
            _pApis.addStore(name, item);
        };

        /**
         * 
         * @param {*} name 
         */
        publicApis.getItem = function(name) {
            if (!name) {
                return indexedDBStorage.privateApi.generateStruct(_privateStore);
            }
            return _privateStore[name];
        };

        /**
         * 
         * @param {*} name 
         */
        publicApis.removeItem = function(name) {
            _pApis.deleteFromStore(name, function() {
                delete _privateStore[name];
            });
        };

        publicApis.clear = function() {
            _pApis.clearStore(function() {
                _privateStore = {};
            });
        };

        /**
         * 
         * @param {*} name 
         */
        publicApis.usage = function(name) {
            return JSON.stringify(this.getItem(name) || '').length;
        };

        publicApis.isExists = function(key) {
            return _privateStore.hasOwnProperty(key);
        };

        return publicApis;
    }

    /**
     * register the storage
     */
    return indexedDBStorage;
}));