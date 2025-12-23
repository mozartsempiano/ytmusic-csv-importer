// ==UserScript==
// @name         yt-csv-importer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Import songs from a CSV file to a YouTube Music playlist
// @author       mozartsempiano
// @match        https://music.youtube.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Enable for detailed logs in the console
  const debug = true;

  function log(...args) {
    if (debug) console.log("[YT CSV IMPORT]", ...args);
  }

  // Adds the import button to the playlist creation modal header
  function addImportButton() {
    const playlistForm = document.querySelector("ytmusic-playlist-form");
    if (!playlistForm) return;
    const header = playlistForm.querySelector(".header");
    if (!header) return;
    if (header.querySelector("#csv-import-btn")) return;

    // Injects all button CSS (transferred from inline)
    if (!document.getElementById("csv-import-btn-style")) {
      const style = document.createElement("style");
      style.id = "csv-import-btn-style";
      style.textContent = `
        #csv-import-btn {
          padding: 0 16px;
          background: #f1f1f1;
          color: #0f0f0f;
          border: none;
          border-radius: 18px;
          cursor: pointer;
          font-size: 14px;
          line-height: 36px;
          white-space: nowrap;
          text-transform: none;
          font-family: "Roboto","Arial",sans-serif;
          font-weight: 500;
          height: 36px;
        }
        
        #csv-import-btn:hover {
          background: #d9d9d9;
          border-color: transparent;
        }

        .header.ytmusic-playlist-form {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
      `;
      document.head.appendChild(style);
    }
    const btn = document.createElement("button");
    btn.id = "csv-import-btn";
    btn.textContent = "Import CSV";

    const headerForm = document.querySelector(".header.ytmusic-playlist-form") || header;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv";
    fileInput.style.display = "none";

    btn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (debug) log("Selected file:", file?.name);
      if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          const csv = evt.target.result;
          if (debug) log("CSV loaded, size:", csv.length);
          processCSV(csv, file.name);
        };
        reader.readAsText(file);
      }
    };

    header.appendChild(btn);
    header.appendChild(fileInput);
  }

  async function processCSV(csv, csvFileName) {
    if (debug) log("Starting CSV processing");
    const rows = csv.split("\n").filter((r) => r.trim());
    const header = rows.shift();
    const columns = header.split(",");
    if (debug) log("Detected columns:", columns);
    const nameIdx = columns.indexOf("Track Name");
    const artistIdx = columns.indexOf("Artist Name(s)");

    if (nameIdx === -1 || artistIdx === -1) {
      if (debug) log("Track Name or Artist Name(s) columns not found");
      alert("Invalid CSV: Track Name or Artist Name(s) columns not found");
      return;
    }

    const tracks = rows
      .map((row, i) => {
        const values = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map((v) => v.replace(/^"|"$/g, ""));
        if (!values) {
          if (debug) log(`Line ${i + 2} ignored (could not be parsed):`, row);
          return null;
        }
        return {
          name: values[nameIdx],
          artist: values[artistIdx],
        };
      })
      .filter(Boolean);
    if (debug) log(`Total tracks detected: ${tracks.length}`);

    let defaultName = "Imported from CSV";
    if (csvFileName) {
      defaultName = csvFileName.replace(/\.[^/.]+$/, "");
    }
    const playlistName = prompt("New playlist name:", defaultName);
    if (!playlistName) return;
    if (debug) log("Playlist name set:", playlistName);
    await createPlaylist(playlistName, tracks);
  }

  async function createPlaylist(playlistName, tracks) {
    if (debug) log("Filling playlist name in the form...");
    const titleInput = document.querySelector("tp-yt-paper-input#title-input input");
    if (titleInput) {
      titleInput.focus();
      titleInput.value = playlistName;
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(200);
      const createBtn = Array.from(document.querySelectorAll('button[aria-label="Create"]')).find(
        (btn) => btn.offsetParent !== null
      );
      if (createBtn) {
        if (debug) log('Clicking "Create" button');
        createBtn.click();
      } else {
        if (debug) log('"Create" button not found');
        return;
      }
    } else {
      if (debug) log("Playlist name input not found");
      return;
    }

    await sleep(4000);
    log("Waiting a bit before starting search...");

    let success = 0;
    let fail = 0;
    for (const track of tracks) {
      if (debug) log(`Processing track: ${track.name} - ${track.artist}`);
      try {
        const ok = await searchAndAddToPlaylist(track.name, track.artist, playlistName);
        if (ok === false) {
          fail++;
        } else {
          success++;
        }
      } catch (e) {
        fail++;
        log(`Error importing '${track.name} - ${track.artist}':`, e);
      }
    }
    log(`Import finished: ${success} tracks imported successfully, ${fail} failed.`);
    if (typeof observer !== "undefined") observer.disconnect();
    throw new Error("Import process finished by script.");
  }

  async function searchAndAddToPlaylist(trackName, artist, playlistName) {
    if (debug) log(`Searching: ${trackName} ${artist}`);
    const searchBox = document.querySelector(".ytmusic-search-box input");
    if (!searchBox) {
      if (debug) log("Search bar not found");
      return;
    }
    const searchValue = `${trackName} ${artist}`;
    await sleep(1000);
    searchBox.value = searchValue;
    searchBox.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => searchBox.value === searchValue, 2000);
    if (debug) log("Search box value confirmed:", searchBox.value);

    // Ensure the field is focused before sending Enter
    searchBox.focus();
    await sleep(200);

    let entered = false;
    for (let attempt = 1; attempt <= 2 && !entered; attempt++) {
      try {
        if (debug) log(`Sending Enter/keypress to search bar (attempt ${attempt})`);
        // keydown
        searchBox.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
        );
        // keypress
        searchBox.dispatchEvent(
          new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
        );
        // keyup
        searchBox.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
        );
        await sleep(200);
        // Try to submit the form if it exists
        if (searchBox.form) {
          if (debug) log("Trying to submit searchBox form");
          searchBox.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        if (debug) log("Enter/keypress sent");
        entered = true;
      } catch (e) {
        if (debug) log(`Error sending Enter/keypress to search (attempt ${attempt}):`, e);
        if (attempt < 2) {
          if (debug) log("Trying again in 2s...");
          await sleep(2000);
        }
      }
      if (!entered) await sleep(1000);
    }
    if (!entered) {
      if (debug) log("Failed to send Enter/keypress after 2 attempts");
    }

    if (debug) log("Waiting for results...");
    await waitFor(() => document.querySelector("ytmusic-shelf-renderer"), 10000);
    await sleep(1000);
    // Find the 'Save to playlist' button using main classes and containers
    const saveBtn = Array.from(document.querySelectorAll('button[aria-label*="Salvar na playlist"]')).find(
      (btn) => btn.offsetParent !== null
    );
    if (saveBtn) {
      if (debug) log("Clicking 'Save to playlist'");
      saveBtn.click();
      await waitFor(() => document.querySelector("#playlists"), 5000).catch(() => {});
      const playlistBtn = Array.from(
        document.querySelectorAll("#playlists ytmusic-playlist-add-to-option-renderer button")
      ).find(
        (btn) =>
          btn.textContent.trim() === playlistName.trim() ||
          btn.getAttribute("aria-label")?.trim() === playlistName.trim()
      );
      if (playlistBtn) {
        if (debug) log(`Clicking playlist: ${playlistName}`);
        playlistBtn.click();
        await sleep(200);
        return true;
      } else {
        if (debug) log(`Playlist '${playlistName}' not found in modal`);
        return false;
      }
    } else {
      if (debug) log("'Save to playlist' button not found");
      return false;
    }
    await sleep(200);
    return false;
  }

  // Waits for a condition to be true or times out
  function waitFor(fn, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (fn()) return resolve();
        if (Date.now() - start > timeout) return reject();
        setTimeout(check, 200);
      })();
    });
  }
  // Sleep utility
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Observe DOM changes to inject the import button when needed
  const observer = new MutationObserver(addImportButton);
  observer.observe(document.body, { childList: true, subtree: true });

  addImportButton();
})();
