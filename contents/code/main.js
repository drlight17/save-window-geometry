var scriptVersion = "2.3";
var store = {};
var blacklist = [];
var lastPersistAt = 0;
var persistIntervalMs = 1000;
var persistErrorLogged = false;

var storageService = "org.kde.savewindowgeometry";
var storagePath = "/SaveWindowGeometry";
var storageInterface = "org.kde.SaveWindowGeometry";
var storageKey = "state";

function log(message) {
    try {
        console.log("save-window-geometry: " + message);
    } catch (e) {
    }
}

function nowMs() {
    return (new Date()).getTime();
}

function asString(value) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
}

function isUsableRect(rect) {
    return rect !== null && rect !== undefined &&
           isFinite(rect.x) && isFinite(rect.y) &&
           isFinite(rect.width) && isFinite(rect.height) &&
           rect.width > 0 && rect.height > 0;
}

function countKeys(object) {
    var count = 0;
    for (var key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
            count++;
        }
    }
    return count;
}

function parseBlacklist(text) {
    var normalized = String(text).replace(/,/g, "\n");
    var lines = normalized.split("\n");
    var entries = [];
    for (var i = 0; i < lines.length; i++) {
        var entry = lines[i].trim().toLowerCase();
        if (entry && entries.indexOf(entry) < 0) {
            entries.push(entry);
        }
    }
    return entries;
}

function readBlacklist() {
    var text = "";
    try {
        text = asString(readConfig("Blacklist", ""));
    } catch (e) {
        text = "";
    }
    var entries = parseBlacklist(text);
    var changed = entries.join("|") !== blacklist.join("|");
    blacklist = entries;
    return changed;
}

function matchingBlacklistEntry(client) {
    if (blacklist.length === 0) {
        return "";
    }
    var identifiers = [
        asString(client.resourceClass),
        asString(client.resourceName),
        asString(client.desktopFileName),
        asString(client.windowRole)
    ];
    for (var i = 0; i < identifiers.length; i++) {
        var value = identifiers[i].trim().toLowerCase();
        if (value) {
            var index = blacklist.indexOf(value);
            if (index >= 0) {
                return blacklist[index];
            }
        }
    }
    return "";
}

function isBlacklisted(client) {
    return matchingBlacklistEntry(client) !== "";
}

function blacklistEntryFor(client) {
    var candidates = [
        asString(client.resourceClass),
        asString(client.resourceName),
        asString(client.desktopFileName)
    ];
    for (var i = 0; i < candidates.length; i++) {
        var value = candidates[i].trim();
        if (value) {
            return value.toLowerCase();
        }
    }
    return "";
}

function addToBlacklist(client) {
    if (!client || !isEligibleWindow(client) || isBlacklisted(client)) {
        return false;
    }
    var entry = blacklistEntryFor(client);
    if (!entry) {
        log("could not determine a window class to ignore");
        return false;
    }
    blacklist.push(entry);
    log("ignoring window class: " + entry);
    try {
        callDBus(storageService, storagePath, storageInterface, "AddBlacklistEntry", entry);
    } catch (e) {
        log("could not persist blacklist entry: " + e);
    }
    return true;
}

function removeFromBlacklist(entry) {
    if (!entry) {
        return false;
    }
    var index = blacklist.indexOf(entry);
    if (index < 0) {
        return false;
    }
    blacklist.splice(index, 1);
    log("no longer ignoring window class: " + entry);
    try {
        callDBus(storageService, storagePath, storageInterface, "RemoveBlacklistEntry", entry);
    } catch (e) {
        log("could not persist blacklist removal: " + e);
    }
    return true;
}

function toggleBlacklist(client) {
    if (!client || !isEligibleWindow(client)) {
        return false;
    }
    var existing = matchingBlacklistEntry(client);
    if (existing) {
        return removeFromBlacklist(existing);
    }
    return addToBlacklist(client);
}

function registerBlacklistPicker() {
    try {
        registerUserActionsMenu(function(client) {
            if (!isEligibleWindow(client)) {
                return null;
            }
            return {
                text: "Ignore for Save Window Geometry",
                checkable: true,
                checked: isBlacklisted(client),
                triggered: function() {
                    toggleBlacklist(client);
                }
            };
        });
    } catch (e) {
        log("could not register the window menu action: " + e);
    }

    try {
        registerShortcut("SaveWindowGeometryIgnoreWindow",
                         "Ignore active window for Save Window Geometry",
                         "Meta+Shift+I",
                         function() {
                             var client = workspace.activeClient;
                             if (client) {
                                 addToBlacklist(client);
                             }
                         });
    } catch (e2) {
        log("could not register the ignore-window shortcut: " + e2);
    }
}

function isEligibleWindow(client) {
    if (!client) {
        return false;
    }
    try {
        if (!client.normalWindow) {
            return false;
        }
        if (client.specialWindow || client.deleted || client.popupWindow) {
            return false;
        }
        if (client.desktopWindow || client.dock || client.toolbar || client.menu ||
            client.splash || client.utility || client.notification ||
            client.onScreenDisplay) {
            return false;
        }
        if (client.modal || client.transient) {
            return false;
        }
        if (client.managed === false) {
            return false;
        }
    } catch (e) {
        return false;
    }
    return true;
}

function isRegularWindow(client) {
    return isEligibleWindow(client) && !isBlacklisted(client);
}


function windowKey(client) {
    var resourceClass = asString(client.resourceClass).toLowerCase();
    var resourceName = asString(client.resourceName).toLowerCase();
    var windowRole = asString(client.windowRole);
    var desktopFileName = asString(client.desktopFileName).toLowerCase();

    if (!resourceClass && !resourceName && !desktopFileName) {
        return null;
    }
    if (!resourceClass && !resourceName) {
        return "desktopfile:" + desktopFileName + "|" + windowRole;
    }
    return resourceClass + "|" + resourceName + "|" + windowRole;
}

function clientArea(client, option) {
    var area = null;
    try {
        area = workspace.clientArea(option, client.screen, workspace.currentDesktop);
    } catch (e) {
        area = null;
    }
    if (isUsableRect(area)) {
        return { x: area.x, y: area.y, width: area.width, height: area.height };
    }

    try {
        area = workspace.clientArea(option, client);
    } catch (e2) {
        area = null;
    }
    if (isUsableRect(area)) {
        return { x: area.x, y: area.y, width: area.width, height: area.height };
    }

    return null;
}

function screenAreaAt(index, option) {
    try {
        var area = workspace.clientArea(option, index, workspace.currentDesktop);
        if (isUsableRect(area)) {
            return { x: area.x, y: area.y, width: area.width, height: area.height };
        }
    } catch (e) {
    }
    return null;
}

function rectsClose(a, b, tolerance) {
    return Math.abs(a.x - b.x) <= tolerance &&
           Math.abs(a.y - b.y) <= tolerance &&
           Math.abs(a.width - b.width) <= tolerance &&
           Math.abs(a.height - b.height) <= tolerance;
}

function rectInside(outer, rect) {
    return rect.x >= outer.x && rect.y >= outer.y &&
           rect.x + rect.width <= outer.x + outer.width &&
           rect.y + rect.height <= outer.y + outer.height;
}

function screenIndexForRect(rect, fallback) {
    var count = 0;
    try {
        count = workspace.numScreens;
    } catch (e) {
    }
    if (!(count > 0)) {
        return fallback;
    }

    var centerX = rect.x + rect.width / 2;
    var centerY = rect.y + rect.height / 2;
    for (var i = 0; i < count; i++) {
        var area = screenAreaAt(i, KWin.ScreenArea);
        if (area && centerX >= area.x && centerX < area.x + area.width &&
            centerY >= area.y && centerY < area.y + area.height) {
            return i;
        }
    }

    var best = fallback;
    var bestArea = 0;
    for (var j = 0; j < count; j++) {
        var screen = screenAreaAt(j, KWin.ScreenArea);
        if (!screen) {
            continue;
        }
        var overlapWidth = Math.min(rect.x + rect.width, screen.x + screen.width) - Math.max(rect.x, screen.x);
        var overlapHeight = Math.min(rect.y + rect.height, screen.y + screen.height) - Math.max(rect.y, screen.y);
        if (overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight > bestArea) {
            bestArea = overlapWidth * overlapHeight;
            best = j;
        }
    }
    return best;
}

function targetScreenForMaximized(client, entry) {
    var count = 0;
    try {
        count = workspace.numScreens;
    } catch (e) {
    }
    if (!(count > 0)) {
        return -1;
    }

    var storedScreen = -1;
    if (typeof entry.maxScreen === "number" && isFinite(entry.maxScreen) &&
        entry.maxScreen >= 0 && entry.maxScreen < count) {
        storedScreen = Math.floor(entry.maxScreen);
    }

    if (isUsableRect(entry.maxArea)) {
        if (storedScreen >= 0) {
            var ownArea = screenAreaAt(storedScreen, KWin.MaximizeArea);
            if (ownArea && rectsClose(ownArea, entry.maxArea, 24)) {
                return storedScreen;
            }
        }
        for (var i = 0; i < count; i++) {
            var area = screenAreaAt(i, KWin.MaximizeArea);
            if (area && rectsClose(area, entry.maxArea, 24)) {
                return i;
            }
        }
    }

    if (storedScreen >= 0) {
        return storedScreen;
    }

    var fallback = 0;
    try {
        if (client.screen >= 0) {
            fallback = client.screen;
        }
    } catch (e2) {
    }
    return screenIndexForRect({ x: entry.x, y: entry.y, width: entry.width, height: entry.height }, fallback);
}

function normalRectOnScreen(client, entry, screenIndex) {
    var area = screenAreaAt(screenIndex, KWin.ScreenArea);
    if (!area) {
        area = screenAreaAt(screenIndex, KWin.MaximizeArea);
    }

    var width = Math.round(entry.width);
    var height = Math.round(entry.height);
    if (!(width > 0) || !(height > 0) || !isFinite(width) || !isFinite(height)) {
        width = 640;
        height = 480;
    }

    if (!area) {
        return fitToDesktop(client, entry);
    }

    if (width > area.width) {
        width = Math.round(area.width);
    }
    if (height > area.height) {
        height = Math.round(area.height);
    }

    var rect = { x: Math.round(entry.x), y: Math.round(entry.y), width: width, height: height };
    if (rectInside(area, rect)) {
        return rect;
    }

    return {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width: width,
        height: height
    };
}

function isMaximizedGeometry(client, rect) {
    var area = clientArea(client, KWin.MaximizeArea);
    if (!area) {
        return false;
    }
    var tolerance = 8;
    return Math.abs(rect.x - area.x) <= tolerance &&
           Math.abs(rect.y - area.y) <= tolerance &&
           Math.abs((rect.x + rect.width) - (area.x + area.width)) <= tolerance &&
           Math.abs((rect.y + rect.height) - (area.y + area.height)) <= tolerance;
}

function normalizeEntry(raw, maxUpdated) {
    if (!raw || !isUsableRect(raw)) {
        return null;
    }
    var updated = 0;
    if (typeof raw.updated === "number" && isFinite(raw.updated) && raw.updated > 0) {
        updated = raw.updated;
    }
    if (maxUpdated !== undefined && maxUpdated !== null && updated > maxUpdated) {
        updated = maxUpdated;
    }

    var maxScreen = -1;
    if (typeof raw.maxScreen === "number" && isFinite(raw.maxScreen) && raw.maxScreen >= 0) {
        maxScreen = Math.floor(raw.maxScreen);
    }

    var maxArea = null;
    if (raw.maxArea && isUsableRect(raw.maxArea)) {
        maxArea = {
            x: Math.round(raw.maxArea.x),
            y: Math.round(raw.maxArea.y),
            width: Math.round(raw.maxArea.width),
            height: Math.round(raw.maxArea.height)
        };
    }

    return {
        x: Math.round(raw.x),
        y: Math.round(raw.y),
        width: Math.round(raw.width),
        height: Math.round(raw.height),
        maximized: !!raw.maximized,
        maxScreen: maxScreen,
        maxArea: maxArea,
        updated: updated
    };
}

function remember(client, seed) {
    if (!isRegularWindow(client) || client._saveGeometryRestoring) {
        return;
    }

    var key = client._saveGeometryKey;
    if (!key) {
        key = windowKey(client);
        if (!key) {
            return;
        }
        client._saveGeometryKey = key;
    }

    var geometry = null;
    try {
        geometry = client.frameGeometry;
    } catch (e) {
        return;
    }
    if (!isUsableRect(geometry)) {
        return;
    }

    try {
        if (client.fullScreen || client.shade || client.hidden) {
            return;
        }
    } catch (e2) {
    }

    var previous = store[key];
    if (seed && previous) {
        return;
    }

    var rect = normalizeEntry(geometry);
    if (!rect) {
        return;
    }

    if (isMaximizedGeometry(client, rect)) {
        var maximizedArea = clientArea(client, KWin.MaximizeArea);
        var maximizedScreen = -1;
        try {
            if (client.screen >= 0) {
                maximizedScreen = client.screen;
            }
        } catch (e3) {
        }
        if (previous && previous.width > 0 && previous.height > 0) {
            previous.maximized = true;
            previous.maxScreen = maximizedScreen;
            previous.maxArea = maximizedArea;
            if (!seed) {
                previous.updated = nowMs();
            }
        } else {
            rect.maximized = true;
            rect.maxScreen = maximizedScreen;
            rect.maxArea = maximizedArea;
            rect.updated = seed ? 0 : nowMs();
            store[key] = rect;
        }
    } else {
        rect.maximized = false;
        rect.maxScreen = -1;
        rect.maxArea = null;
        rect.updated = seed ? 0 : nowMs();
        store[key] = rect;
    }

    if (!seed) {
        schedulePersist();
    }
}

function readStoredText() {
    try {
        var value = readConfig(storageKey, "");
        if (value === undefined || value === null || value === "") {
            return "";
        }
        return String(value);
    } catch (e) {
        return "";
    }
}

function parseStored(text) {
    if (!text) {
        return null;
    }
    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return null;
    }
    var windows = data.windows;
    if (!windows || typeof windows !== "object" || Array.isArray(windows)) {
        return null;
    }
    return windows;
}

function mergeStored(text) {
    var windows = parseStored(text);
    if (!windows) {
        return false;
    }
    var changed = false;
    var now = nowMs();
    for (var key in windows) {
        if (!Object.prototype.hasOwnProperty.call(windows, key)) {
            continue;
        }
        var entry = normalizeEntry(windows[key], now);
        if (!entry) {
            continue;
        }
        var existing = store[key];
        if (!existing || existing.updated === 0 || entry.updated > existing.updated) {
            store[key] = entry;
            changed = true;
        }
    }
    return changed;
}

function serializeState() {
    var windows = {};
    for (var key in store) {
        if (!Object.prototype.hasOwnProperty.call(store, key)) {
            continue;
        }
        var entry = store[key];
        var copy = {
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
            maximized: !!entry.maximized,
            updated: entry.updated
        };
        if (entry.maximized) {
            copy.maxScreen = entry.maxScreen;
            copy.maxArea = entry.maxArea;
        }
        windows[key] = copy;
    }
    return JSON.stringify({
        version: 1,
        savedAt: nowMs(),
        windows: windows
    });
}

function persistNow() {
    if (countKeys(store) === 0) {
        return;
    }
    lastPersistAt = nowMs();
    var payload;
    try {
        payload = serializeState();
    } catch (e) {
        return;
    }
    try {
        callDBus(storageService, storagePath, storageInterface, "Store", payload);
    } catch (e2) {
        if (!persistErrorLogged) {
            persistErrorLogged = true;
            log("could not store geometry: " + e2);
        }
    }
}

function schedulePersist() {
    var now = nowMs();
    if (now - lastPersistAt >= persistIntervalMs) {
        persistNow();
    }
}

function requestPersistedState() {
    try {
        callDBus(storageService, storagePath, storageInterface, "Sync");
    } catch (e) {
    }
}

function hasVisiblePart(rect) {
    var screenCount = 0;
    try {
        screenCount = workspace.numScreens;
    } catch (e) {
    }
    if (!(screenCount > 0)) {
        return true;
    }

    var desktop = 1;
    try {
        desktop = workspace.currentDesktop;
    } catch (e2) {
    }

    for (var screen = 0; screen < screenCount; screen++) {
        var area = null;
        try {
            area = workspace.clientArea(KWin.ScreenArea, screen, desktop);
        } catch (e3) {
            continue;
        }
        if (!isUsableRect(area)) {
            continue;
        }
        var visibleWidth = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
        var visibleHeight = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
        if (visibleWidth >= 64 && visibleHeight >= 32) {
            return true;
        }
    }

    return false;
}

function fitToDesktop(client, entry) {
    var width = Math.round(entry.width);
    var height = Math.round(entry.height);
    var x = Math.round(entry.x);
    var y = Math.round(entry.y);

    if (!isFinite(x)) {
        x = 0;
    }
    if (!isFinite(y)) {
        y = 0;
    }
    if (!(width > 0) || !(height > 0) || !isFinite(width) || !isFinite(height)) {
        width = 640;
        height = 480;
    }

    var rect = { x: x, y: y, width: width, height: height };
    if (hasVisiblePart(rect)) {
        return rect;
    }

    var area = clientArea(client, KWin.ScreenArea);
    if (!area) {
        area = clientArea(client, KWin.MaximizeArea);
    }
    if (!area) {
        return rect;
    }

    if (width > area.width) {
        width = Math.round(area.width);
    }
    if (height > area.height) {
        height = Math.round(area.height);
    }

    return {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width: width,
        height: height
    };
}

function restore(client, key) {
    var entry = store[key];
    if (!entry) {
        return;
    }

    var rect;
    if (entry.maximized) {
        var targetScreen = targetScreenForMaximized(client, entry);
        if (targetScreen >= 0) {
            rect = normalRectOnScreen(client, entry, targetScreen);
        } else {
            rect = fitToDesktop(client, entry);
        }
    } else {
        rect = fitToDesktop(client, entry);
    }

    client._saveGeometryRestoring = true;
    try {
        client.frameGeometry = rect;
        if (entry.maximized) {
            var maximizable = false;
            try {
                maximizable = !!client.maximizable;
            } catch (e) {
            }
            if (maximizable) {
                try {
                    client.setMaximize(true, true);
                } catch (e2) {
                    log("could not restore maximized state of " + key + ": " + e2);
                }
            }
        }
    } catch (e3) {
        log("could not restore geometry of " + key + ": " + e3);
    } finally {
        client._saveGeometryRestoring = false;
    }
}

function track(client, allowRestore, seed) {
    if (!isRegularWindow(client) || client._saveGeometryTracked) {
        return;
    }

    var key = windowKey(client);
    if (!key) {
        return;
    }

    client._saveGeometryTracked = true;
    client._saveGeometryKey = key;

    try {
        client.frameGeometryChanged.connect(function() {
            remember(client, false);
        });
    } catch (e) {
        log("could not watch geometry of " + key + ": " + e);
    }

    try {
        client.clientFinishUserMovedResized.connect(function() {
            remember(client, false);
            persistNow();
        });
    } catch (e2) {
    }

    if (allowRestore && store[key]) {
        restore(client, key);
    } else {
        remember(client, seed);
    }
}

function onConfigChanged() {
    if (mergeStored(readStoredText())) {
        log("loaded " + countKeys(store) + " stored window geometry record(s)");
    }
    if (readBlacklist()) {
        log("blacklist updated: " + blacklist.length + " entr(y/ies)");
    }
}

function init() {
    readBlacklist();

    var initial = readStoredText();
    if (initial) {
        mergeStored(initial);
    }

    try {
        if (typeof options !== "undefined" && options.configChanged) {
            options.configChanged.connect(onConfigChanged);
        }
    } catch (e) {
        log("could not watch configuration changes: " + e);
    }

    try {
        workspace.clientAdded.connect(function(client) {
            track(client, true, false);
        });
    } catch (e2) {
        log("could not connect to clientAdded: " + e2);
    }

    try {
        workspace.clientRemoved.connect(function() {
            persistNow();
        });
    } catch (e3) {
    }

    requestPersistedState();
    registerBlacklistPicker();

    var existing = [];
    try {
        existing = workspace.clientList();
    } catch (e4) {
        existing = [];
    }

    for (var i = 0; i < existing.length; i++) {
        track(existing[i], false, true);
    }

    log("v" + scriptVersion + " loaded: tracking " + existing.length + " existing window(s), " +
        countKeys(store) + " stored record(s), " + blacklist.length + " blacklisted class(es)");
}

init();
