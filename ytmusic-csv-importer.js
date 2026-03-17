// ==UserScript==
// @name         ytmusic-csv-importer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically import songs from a CSV file to a YouTube Music playlist
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

	function mapLanguage(lang) {
		const normalized = (lang || "").toString().toLowerCase().replace("_", "-");
		if (normalized.startsWith("pt")) return "pt";
		if (normalized.startsWith("es")) return "es";
		return "en";
	}

	const LANG_INFO = (() => {
		const htmlLang = document.documentElement.lang || "";
		const navigatorLang = navigator.language || "";
		const navigatorLanguages = Array.isArray(navigator.languages)
			? navigator.languages
			: [];
		const urlLang = new URLSearchParams(window.location.search).get("hl") || "";
		const ytcfgLang =
			window.ytcfg?.get?.("HL") ||
			window.ytcfg?.data_?.HL ||
			window.ytcfg?.data_?.HL_LOCALE ||
			"";

		const sourceCandidates = [
			ytcfgLang,
			urlLang,
			htmlLang,
			...navigatorLanguages,
			navigatorLang,
			"en",
		].filter(Boolean);

		const raw = sourceCandidates[0] || "en";
		const mapped = mapLanguage(raw);
		return {
			raw,
			mapped,
			ytcfgLang,
			urlLang,
			htmlLang,
			navigatorLang,
			navigatorLanguages,
		};
	})();

	const LANG = LANG_INFO.mapped;
	if (debug)
		log("Idioma detectado:", {
			...LANG_INFO,
			usadoPeloScript: LANG,
		});

	const I18N = {
		en: {
			importBtn: "Import CSV",
			create: "Create",
			saveToPlaylist: "Save to playlist",
			invalidCSV: "Invalid CSV: Track Name or Artist Name(s) columns not found",
			defaultPlaylist: "Imported from CSV",
			track: "Track Name",
			artist: "Artist Name(s)",
		},
		pt: {
			importBtn: "Importar CSV",
			create: "Criar",
			saveToPlaylist: "Salvar na playlist",
			invalidCSV:
				"CSV inválido: colunas Track Name ou Artist Name(s) não encontradas",
			defaultPlaylist: "Importado do CSV",
			track: "Track Name",
			artist: "Artist Name(s)",
		},
		es: {
			importBtn: "Import CSV",
			create: "Create",
			saveToPlaylist: "Guardar en la playlist",
			invalidCSV:
				"CSV inválido: columnas Track Name o Artist Name(s) no encontradas",
			defaultPlaylist: "Imported from CSV",
			track: "Track Name",
			artist: "Artist Name(s)",
		},
	};

	const t = (k) => I18N[LANG]?.[k] || I18N.en[k];
	const SONGS_FILTER_TERMS = ["Songs", "Musicas", "Canciones"];
	const SAVE_TO_PLAYLIST_TERMS = [
		"Save to playlist",
		"Add to playlist",
		"Salvar na playlist",
		"Adicionar a playlist",
		"Guardar en la playlist",
		"Agregar a la playlist",
	];
	const MENU_BUTTON_TERMS = [
		"More actions",
		"Action menu",
		"Mais acoes",
		"Menu de acoes",
		"Mas acciones",
		"Acciones",
	];
	const SAVE_ACTION_TERMS = ["save", "add", "salvar", "adicionar", "guardar", "agregar"];

	function normalizeText(value = "") {
		return value
			.toString()
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.trim();
	}

	function hasTerm(value, terms) {
		const normalizedValue = normalizeText(value);
		return terms.some((term) => normalizedValue.includes(normalizeText(term)));
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
		btn.textContent = t("importBtn");

		const headerForm =
			document.querySelector(".header.ytmusic-playlist-form") || header;

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
		const nameIdx = columns.indexOf(t("track"));
		const artistIdx = columns.indexOf(t("artist"));

		if (nameIdx === -1 || artistIdx === -1) {
			if (debug) log("Track Name or Artist Name(s) columns not found");
			alert(t("invalidCSV"));
			return;
		}

		const tracks = rows
			.map((row, i) => {
				const values = row
					.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)
					?.map((v) => v.replace(/^"|"$/g, ""));
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

		let defaultName = t("defaultPlaylist");
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
		const titleInput = document.querySelector(
			"tp-yt-paper-input#title-input input",
		);
		if (titleInput) {
			titleInput.focus();
			titleInput.value = playlistName;
			titleInput.dispatchEvent(new Event("input", { bubbles: true }));
			await sleep(200);
			const createBtn = Array.from(
				document.querySelectorAll('button[aria-label="' + t("create") + '"]'),
			).find((btn) => btn.offsetParent !== null);
			if (createBtn) {
				if (debug) log('Clicking "' + t("create") + '" button');
				createBtn.click();
			} else {
				if (debug) log('"' + t("create") + '" button not found');
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
				const ok = await searchAndAddToPlaylist(
					track.name,
					track.artist,
					playlistName,
				);
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
		log(
			`Import finished: ${success} tracks imported successfully, ${fail} failed.`,
		);
		if (typeof observer !== "undefined") observer.disconnect();
		throw new Error("Import process finished by script.");
	}

	async function searchAndAddToPlaylist(trackName, artist, playlistName) {
		if (debug) log(`Searching: ${trackName} ${artist}`);
		const searchBox = document.querySelector(".ytmusic-search-box input");
		if (!searchBox) {
			if (debug) log("Search bar not found");
			return false;
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
				if (debug)
					log(`Sending Enter/keypress to search bar (attempt ${attempt})`);
				// keydown
				searchBox.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						code: "Enter",
						keyCode: 13,
						which: 13,
						bubbles: true,
					}),
				);
				// keypress
				searchBox.dispatchEvent(
					new KeyboardEvent("keypress", {
						key: "Enter",
						code: "Enter",
						keyCode: 13,
						which: 13,
						bubbles: true,
					}),
				);
				// keyup
				searchBox.dispatchEvent(
					new KeyboardEvent("keyup", {
						key: "Enter",
						code: "Enter",
						keyCode: 13,
						which: 13,
						bubbles: true,
					}),
				);
				await sleep(200);
				// Try to submit the form if it exists
				if (searchBox.form) {
					if (debug) log("Trying to submit searchBox form");
					searchBox.form.dispatchEvent(
						new Event("submit", { bubbles: true, cancelable: true }),
					);
				}
				if (debug) log("Enter/keypress sent");
				entered = true;
			} catch (e) {
				if (debug)
					log(
						`Error sending Enter/keypress to search (attempt ${attempt}):`,
						e,
					);
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
		await waitFor(
			() => document.querySelector("ytmusic-shelf-renderer"),
			10000,
		);
		await sleep(1000);
		await clickSongsFilter();
		const saveDialogOpened = await openSaveToPlaylistDialog(trackName, artist);
		if (!saveDialogOpened) {
			if (debug) log("Could not open 'Save to playlist' action");
			return false;
		}

		await waitFor(() => document.querySelector("#playlists"), 5000).catch(
			() => {},
		);
		const playlistBtn = Array.from(
			document.querySelectorAll(
				"#playlists ytmusic-playlist-add-to-option-renderer button",
			),
		).find(
			(btn) =>
				btn.textContent.trim() === playlistName.trim() ||
				btn.getAttribute("aria-label")?.trim() === playlistName.trim(),
		);
		if (playlistBtn) {
			if (debug) log(`Clicking playlist: ${playlistName}`);
			playlistBtn.click();
			await sleep(200);
			return true;
		}

		if (debug) log(`Playlist '${playlistName}' not found in modal`);
		return false;
	}

	async function clickSongsFilter() {
		const chipSelector = [
			"a.yt-simple-endpoint.ytmusic-chip-cloud-chip-renderer",
			"ytmusic-chip-cloud-chip-renderer a.yt-simple-endpoint",
			"ytmusic-chip-cloud-chip-renderer",
		].join(", ");

		await waitFor(() => document.querySelector(chipSelector), 5000).catch(
			() => {},
		);
		const chips = Array.from(document.querySelectorAll(chipSelector));
		const songsChip = chips.find((chip) => {
			const content = [
				chip.textContent,
				chip.getAttribute?.("title"),
				chip.getAttribute?.("aria-label"),
			]
				.filter(Boolean)
				.join(" ");
			return hasTerm(content, SONGS_FILTER_TERMS);
		});

		if (!songsChip) {
			if (debug) log("Songs filter chip not found");
			return false;
		}
		if (songsChip.getAttribute?.("aria-selected") === "true") {
			if (debug) log("Songs filter already selected");
			return true;
		}

		if (debug) log("Clicking songs filter chip");
		songsChip.click();
		await waitFor(
			() => songsChip.getAttribute?.("aria-selected") === "true",
			3000,
		).catch(() => {});
		await sleep(700);
		return true;
	}

	async function openSaveToPlaylistDialog(trackName, artist) {
		const directSaveBtn = Array.from(document.querySelectorAll("button")).find(
			(btn) =>
				isVisible(btn) &&
				hasTerm(getElementText(btn), [t("saveToPlaylist"), ...SAVE_TO_PLAYLIST_TERMS]),
		);
		if (directSaveBtn) {
			if (debug) log("Clicking direct 'Save to playlist' button");
			directSaveBtn.click();
			return true;
		}

		if (debug)
			log("Direct save button not visible; trying track three-dot menu...");
		const results = Array.from(
			document.querySelectorAll("ytmusic-responsive-list-item-renderer"),
		).filter(isVisible);
		if (!results.length) {
			if (debug) log("No visible search results to open menu from");
			return false;
		}

		const targetResult = pickBestResult(results, trackName, artist);
		const menuBtn = findResultMenuButton(targetResult);
		if (!menuBtn) {
			if (debug) log("Three-dot menu button not found on target result");
			return false;
		}

		if (debug) log("Opening three-dot menu of selected result");
		menuBtn.click();
		await waitFor(() => getMenuActionEntries().length > 0, 5000).catch(
			() => {},
		);

		const saveAction = findSaveToPlaylistMenuItem();
		if (!saveAction) {
			if (debug) log("Save/Add to playlist option not found in action menu");
			if (debug) log("Visible action menu options:", getVisibleMenuOptionTexts());
			return false;
		}

		if (debug) log("Clicking save/add to playlist action in menu");
		saveAction.click();
		return true;
	}

	function pickBestResult(results, trackName, artist) {
		const trackTokens = normalizeText(trackName)
			.split(/\s+/)
			.filter(Boolean);
		const artistTokens = normalizeText(artist)
			.split(/[;,&/ ]+/)
			.filter(Boolean);

		let best = results[0];
		let bestScore = -1;
		for (const result of results) {
			const text = normalizeText(result.textContent);
			let score = 0;
			if (text.includes(normalizeText(trackName))) score += 5;
			for (const token of trackTokens.slice(0, 4)) {
				if (token.length > 2 && text.includes(token)) score += 1;
			}
			for (const token of artistTokens.slice(0, 3)) {
				if (token.length > 2 && text.includes(token)) score += 1;
			}
			if (score > bestScore) {
				best = result;
				bestScore = score;
			}
		}
		return best;
	}

	function findResultMenuButton(resultNode) {
		if (!resultNode) return null;
		const menuSelectors = [
			"ytmusic-menu-renderer tp-yt-paper-icon-button",
			"ytmusic-menu-renderer button",
			'tp-yt-paper-icon-button[aria-label]',
			'button[aria-label]',
		].join(", ");
		const buttons = Array.from(resultNode.querySelectorAll(menuSelectors)).filter(
			isVisible,
		);
		return (
			buttons.find((btn) => hasTerm(getElementText(btn), MENU_BUTTON_TERMS)) ||
			buttons[0] ||
			null
		);
	}

	function findSaveToPlaylistMenuItem() {
		const menuEntries = getMenuActionEntries();
		const exactMatch = menuEntries.find((entry) =>
			hasTerm(entry.text, [t("saveToPlaylist"), ...SAVE_TO_PLAYLIST_TERMS]),
		);
		if (exactMatch) return exactMatch.clickTarget;

		const fuzzyMatch = menuEntries.find(
			(entry) =>
				hasTerm(entry.text, ["playlist"]) &&
				hasTerm(entry.text, SAVE_ACTION_TERMS),
		);
		return fuzzyMatch?.clickTarget || null;
	}

	function getVisibleMenuOptionTexts() {
		return getMenuActionEntries().map((entry) => entry.text);
	}

	function getMenuActionEntries() {
		const items = Array.from(
			document.querySelectorAll("ytmusic-menu-popup-renderer [role='menuitem']"),
		);
		return items
			.map((item) => {
				const text = getElementText(item).replace(/\s+/g, " ").trim();
				const clickTarget =
					item.querySelector(
						"a.yt-simple-endpoint, tp-yt-paper-item#primary-entry, tp-yt-paper-item, button, [role='option']",
					) || item;
				return { text, clickTarget, item };
			})
			.filter((entry) => entry.text);
	}

	function getElementText(el) {
		if (!el) return "";
		return [el.textContent, el.getAttribute("title"), el.getAttribute("aria-label")]
			.filter(Boolean)
			.join(" ");
	}

	function isVisible(el) {
		return !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
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
