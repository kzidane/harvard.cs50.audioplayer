define(function(require, exports, module) {
    main.consumes = [
        "dialog.alert", "dialog.error", "Editor", "editors", "layout",
        "settings", "ui", "vfs", "watcher"
    ];

    main.provides = ["c9.ide.cs50.audioplayer"];
    return main;

    function main(options, imports, register) {
        var Editor = imports.Editor;
        var editors = imports.editors;
        var layout = imports.layout;
        var settings = imports.settings;
        var showAlert = imports["dialog.alert"].show;
        var showError = imports["dialog.error"].show;
        var ui = imports.ui;
        var vfs = imports.vfs;
        var watcher = imports.watcher;

        var basename = require("path").basename;
        var _ = require("lodash");

        // targeted extensions
        var extensions = ["mp3", "ogg", "wav"];
        // register editor
        var handle = editors.register(
            "audioplayer", "Audio Player", AudioPlayer, extensions
        );

        // tab background colors
        var tabBackgrounds = {
            "flat-light": "#F1F1F1",
            "flat-dark": "#3D3D3D",
            "light": "#D3D3D3",
            "light-gray": "#D3D3D3",
            "dark": "#3D3D3D",
            "dark-gray": "#3D3D3D"
        };
        var drawn = false;
        var watchedPaths = {};

        /**
         * Audio player factory.
         */
        function AudioPlayer() {
            var plugin = new Editor("CS50", main.consumes, extensions);

            var container;
            var currentSession;

            /**
             * Sets/updates URL of audio source, tab title to file name, and
             * tooltip to path.
             *
             * @param {object} audioDoc the audio Document to extract data from and act on
             */
            function setPath(audioDoc) {
                if (!_.isObject(audioDoc) || !_.isObject(audioDoc.tab) || !_.isString(audioDoc.tab.path))
                    return;

                var tab = audioDoc.tab;
                var path = tab.path;
                var session = audioDoc.getSession();

                // get URL for file at path
                var fullPath = path.match(/^\w+:\/\//) ? path : vfs.url(path);
                if (session.audio.src === fullPath) {
                    return;
                }
                // set/update src URL and load/reload
                session.audio.src = fullPath;
                session.audio.load();

                // set/update tab title and tooltip
                audioDoc.title = basename(path);
                audioDoc.tooltip = path;

                // watch file for removal or external renaming (e.g., renaming from terminal)
                if (_.isUndefined(watchedPaths[path])) {
                    watcher.watch(path);
                    watchedPaths[path] = tab;
                }
            }

            /**
             * Unwatched a file, if being watched
             *
             * @param {string} path the path of the file being watched
             */
            function unwatch(path) {
                if (!_.isString(path))
                    return;

                if (watchedPaths[path])
                {
                    watcher.unwatch(path);
                    delete watchedPaths[path];
                }
            }

            // draw player (when editor instance first loaded in a pane)
            plugin.on("draw", function(e) {
                // wrapper for player
                container = document.createElement("div");
                container.classList.add("playerwrapper");
                e.htmlNode.appendChild(container);

                // insert CSS once
                if (drawn)
                    return;
                drawn = true;

                ui.insertCss(
                    require("text!./style.css"),
                    options.staticPrefix,
                    handle
                );
            });

            // handle audio file when first opened or moved to different pane
            plugin.on("documentLoad", function(e) {
                var audioDoc = e.doc;
                var session = audioDoc.getSession();
                // avoid re-creating audio element and re-adding listeners
                if (session.audio) {
                    return;
                }
                // create audio element
                session.audio = document.createElement("audio");
                session.audio.setAttribute("controls", "");
                session.audio.setAttribute("preload", "");

                // show error message on loading errors
                session.audio.addEventListener("error", function() {
                    showError("Error loading audio file");
                });
                // preserve playing or pausing state
                session.audio.addEventListener("playing", function() {
                    session.paused = false;
                });
                session.audio.addEventListener("pause", function() {
                    session.paused = true;
                });
                // handle renaming file from tree while open
                audioDoc.tab.on("setPath", function(e) {
                    setPath(audioDoc);
                }, session);

                // alert user and close tab if file no longer available
                watcher.on("delete", function(e) {
                    var path = e.path;
                    var tab = watchedPaths[path];
                    // ensure path is being watched
                    if (_.isUndefined(tab))
                        return;
                    unwatch(path);
                    // alert user and close tab
                    showAlert(
                        "File is no longer available",
                        path + " is no longer available",
                        null,
                        tab.close
                    );
                });

                /**
                 * Sets background color of audio player tab according to a
                 * theme.
                 *
                 * @param {object} e an object with a property, theme, whose
                 * value is theme name
                 */
                function setTabBackground(e) {
                    if (!_.isObject(e) || !_.isString(e.theme))
                        return;

                    var theme = e.theme;
                    var tab = audioDoc.tab;

                    // set tab background color based on theme
                    tab.backgroundColor = tabBackgrounds[theme];

                    if (theme === "dark")
                        tab.classList.add("dark");
                    else
                        tab.classList.remove("dark");
                }

                // change tab background color on theme change
                layout.on("themeChange", setTabBackground, audioDoc);

                // set tab background color initially
                setTabBackground({ theme: settings.get("user/general/@skin") });
            });

            // handle when tab for audio file becomes active
            plugin.on("documentActivate", function(e) {
                var audioDoc = e.doc;
                var session = audioDoc.getSession();
                // hide current player from tab (if any)
                if (currentSession && currentSession !== session) {
                    currentSession.audio.style.display = "none";
                }

                // update current session
                currentSession = session;

                // ensure new player is attached to container
                if (!container.contains(currentSession.audio)) {
                    container.appendChild(currentSession.audio);
                }
                // ensure new player is visible
                currentSession.audio.style.display = "initial";

                // set/update player src URL
                setPath(audioDoc);

                // preserve playing or pausing state (e.g., when moving player to another pane)
                if (currentSession.paused === false && currentSession.audio.paused === true) {
                    currentSession.audio.play();
                }
            });

            // handle document unloading (e.g., when tab is closed or moved to another pane)
            plugin.on("documentUnload", function(e) {
                var audioDoc = e.doc;
                var audio = audioDoc.getSession().audio;
                // remove player from pane
                container.removeChild(audio);
                // unwatch path if being watched
                var path = audioDoc.tab.path;
                unwatch(path);
            });

            plugin.freezePublicAPI({});

            plugin.load(null, "c9.ide.cs50.audioplayer");

            return plugin;
        }

        register(null, {
            "c9.ide.cs50.audioplayer": handle
        });
    }
});
