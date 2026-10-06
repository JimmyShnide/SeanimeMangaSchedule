function init() {
    // Manga Release Schedule v0.1.0
    //
    // Option A architecture:
    // - Hook Seanime's existing anime schedule payload.
    // - Append manga release entries to the same calendar.
    // - Persist fetched data in $storage so the schedule survives restarts.
    //
    // Data source:
    // - MangaDex public API, using future publishAt data where available.
    //
    // Important:
    // MangaDex dates are chapter-publication dates on MangaDex, not guaranteed
    // Japanese magazine serialization dates. Publisher-specific adapters can be
    // added later without changing the schedule/UI layer.

    const DEFAULT_IDS = [
        216202, // Noisering
        30002,  // Berserk
        176740, // Centuria
        102232, // Final Fantasy Lost Stranger
        214286, // First Penguin Requiem
        199496, // FOG LAND
        126559, // Fool Night
        171127, // Inochi no Tabekata
        169355, // Kagurabachi
        213726, // Kaisou Toshi Danpenshuu
        111962, // Kingdom Hearts III
        86551,  // Made in Abyss
        214315, // Myeolgwisudojeon
        111212, // Rebuild World
        125828, // Sakamoto Days
        108556, // SPY x FAMILY
        128067, // SSS-Class Revival Hunter
        132898, // Star Wars Leia, Princess of Alderaan
        141165, // Sword Art Online Re:Aincrad
        164247, // Sword Art Online Unital Ring
        139499, // Sword of the Demon Hunter: Kijin Gentosho
        145531, // The Color of the End: Mission in the Apocalypse
        211928, // The Necromancer of the Renowned Swordmaster Family
        85978,  // The New Gate
        170400, // The Stellar Swordmaster
        144957, // The World After the Fall
        103890  // Under Ninja
    ];

    const DEFAULT_SETTINGS = {
        enabled: true,
        lookaheadDays: 30,
        language: "en",
        includeUnscheduledPast: false,
        titleFormat: "icon",
        refreshMinutes: 60,
        trackedIds: DEFAULT_IDS
    };

    const readSetting = (key, fallback) => {
        const value = $storage.get(key);
        return value === undefined || value === null ? fallback : value;
    };

    const getSettings = () => ({
        enabled: !!readSetting("enabled", DEFAULT_SETTINGS.enabled),
        lookaheadDays: Math.max(1, Math.min(180, parseInt($toString(readSetting("lookaheadDays", DEFAULT_SETTINGS.lookaheadDays))))),
        language: $toString(readSetting("language", DEFAULT_SETTINGS.language)) || "en",
        includeUnscheduledPast: !!readSetting("includeUnscheduledPast", DEFAULT_SETTINGS.includeUnscheduledPast),
        titleFormat: $toString(readSetting("titleFormat", DEFAULT_SETTINGS.titleFormat)) || "icon",
        refreshMinutes: Math.max(15, Math.min(1440, parseInt($toString(readSetting("refreshMinutes", DEFAULT_SETTINGS.refreshMinutes))))),
        trackedIds: readSetting("trackedIds", DEFAULT_SETTINGS.trackedIds)
    });

    const titlePrefix = () => {
        const format = getSettings().titleFormat;
        if (format === "icon-only") return "📖 ";
        if (format === "bracket") return "[MANGA] ";
        return "📖 Manga - ";
    };

    // The schedule hook is the same mechanism used by the existing Dub Schedule
    // plugin to inject entries into Seanime's calendar.
    $app.onAnimeScheduleItems((e) => {
        try {
            const settings = getSettings();

            // Remove entries previously injected by this plugin.
            const prefixes = ["📖 Manga - ", "📖 ", "[MANGA] "];
            const animeItems = (e.items || []).filter(item => {
                const title = item?.title || "";
                return !prefixes.some(prefix => title.startsWith(prefix));
            });

            if (!settings.enabled) {
                e.items = animeItems;
                e.next();
                return;
            }

            const raw = $store.get("manga-release-schedule-items") || [];
            const mangaItems = raw.map(item => ({
                ...item,
                title: `${titlePrefix()}${item.title}`
            }));

            e.items = [...animeItems, ...mangaItems];

            e.items.sort((a, b) => {
                const da = a.dateTime ? new Date(a.dateTime).getTime() : 0;
                const db = b.dateTime ? new Date(b.dateTime).getTime() : 0;
                return da - db;
            });
        } catch (error) {
            console.error("Manga Release Schedule hook error:", error);
            e.next();
            return;
        }

        e.next();
    });

    $ui.register(async (ctx) => {
        const enabledState = ctx.state(getSettings().enabled);
        const lookaheadState = ctx.state(getSettings().lookaheadDays);
        const languageState = ctx.state(getSettings().language);
        const formatState = ctx.state(getSettings().titleFormat);

        const refreshData = async () => {
            ctx.toast.info("Manga Release Schedule: refreshing...");
            try {
                await fetchMangaSchedule();
                $app.invalidateClientQuery(["GetAnimeSchedule"]);
                ctx.toast.success("Manga Release Schedule: updated.");
            } catch (error) {
                console.error("Manga Release Schedule refresh error:", error);
                ctx.toast.error("Manga Release Schedule: refresh failed.");
            }
        };

        ctx.registerEventHandler("refresh-manga-schedule", refreshData);

        ctx.registerEventHandler("set-enabled", () => {
            enabledState.set(!enabledState.get());
        });

        ctx.registerEventHandler("set-lookahead-7", () => lookaheadState.set(7));
        ctx.registerEventHandler("set-lookahead-30", () => lookaheadState.set(30));
        ctx.registerEventHandler("set-lookahead-60", () => lookaheadState.set(60));
        ctx.registerEventHandler("set-lookahead-90", () => lookaheadState.set(90));

        ctx.registerEventHandler("set-language-en", () => languageState.set("en"));
        ctx.registerEventHandler("set-language-all", () => languageState.set("all"));

        ctx.registerEventHandler("set-format-icon", () => formatState.set("icon"));
        ctx.registerEventHandler("set-format-icon-only", () => formatState.set("icon-only"));
        ctx.registerEventHandler("set-format-bracket", () => formatState.set("bracket"));

        ctx.effect(() => {
            $storage.set("enabled", enabledState.get());
            $app.invalidateClientQuery(["GetAnimeSchedule"]);
        }, [enabledState]);

        ctx.effect(() => {
            $storage.set("lookaheadDays", lookaheadState.get());
            fetchMangaSchedule();
        }, [lookaheadState]);

        ctx.effect(() => {
            $storage.set("language", languageState.get());
            fetchMangaSchedule();
        }, [languageState]);

        ctx.effect(() => {
            $storage.set("titleFormat", formatState.get());
            $app.invalidateClientQuery(["GetAnimeSchedule"]);
        }, [formatState]);

        const tray = ctx.newTray({
            tooltipText: "Manga Release Schedule",
            iconUrl: "",
            withContent: true
        });

        tray.render(() => {
            const settings = getSettings();

            return tray.stack({
                gap: 2,
                items: [
                    tray.text("Manga Release Schedule"),
                    tray.button(
                        settings.enabled ? "✅ Manga releases: ON" : "⬜ Manga releases: OFF",
                        { intent: settings.enabled ? "primary" : "gray-subtle", onClick: "set-enabled" }
                    ),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor: "rgba(255,255,255,0.1)",
                            margin: "8px 0"
                        }
                    }),

                    tray.text("Look ahead"),
                    tray.flex({
                        gap: 2,
                        items: [
                            tray.button("7 days", {
                                intent: settings.lookaheadDays === 7 ? "primary" : "gray-subtle",
                                onClick: "set-lookahead-7"
                            }),
                            tray.button("30 days", {
                                intent: settings.lookaheadDays === 30 ? "primary" : "gray-subtle",
                                onClick: "set-lookahead-30"
                            }),
                            tray.button("60 days", {
                                intent: settings.lookaheadDays === 60 ? "primary" : "gray-subtle",
                                onClick: "set-lookahead-60"
                            }),
                            tray.button("90 days", {
                                intent: settings.lookaheadDays === 90 ? "primary" : "gray-subtle",
                                onClick: "set-lookahead-90"
                            })
                        ]
                    }),

                    tray.text("Chapter language"),
                    tray.flex({
                        gap: 2,
                        items: [
                            tray.button("English", {
                                intent: settings.language === "en" ? "primary" : "gray-subtle",
                                onClick: "set-language-en"
                            }),
                            tray.button("Any", {
                                intent: settings.language === "all" ? "primary" : "gray-subtle",
                                onClick: "set-language-all"
                            })
                        ]
                    }),

                    tray.text("Title format"),
                    tray.flex({
                        gap: 2,
                        items: [
                            tray.button("📖 Manga -", {
                                intent: settings.titleFormat === "icon" ? "primary" : "gray-subtle",
                                onClick: "set-format-icon"
                            }),
                            tray.button("📖", {
                                intent: settings.titleFormat === "icon-only" ? "primary" : "gray-subtle",
                                onClick: "set-format-icon-only"
                            }),
                            tray.button("[MANGA]", {
                                intent: settings.titleFormat === "bracket" ? "primary" : "gray-subtle",
                                onClick: "set-format-bracket"
                            })
                        ]
                    }),

                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor: "rgba(255,255,255,0.1)",
                            margin: "8px 0"
                        }
                    }),

                    tray.button("🔄 Refresh releases now", {
                        intent: "gray-subtle",
                        onClick: "refresh-manga-schedule"
                    })
                ]
            });
        });

        // Initial load.
        await fetchMangaSchedule();

        // Refresh automatically.
        ctx.setInterval(
            fetchMangaSchedule,
            getSettings().refreshMinutes * 60 * 1000
        );
    });

    async function fetchMangaSchedule() {
        const settings = getSettings();

        if (!settings.enabled) {
            $store.set("manga-release-schedule-items", []);
            $storage.set("manga-release-schedule-items", []);
            $app.invalidateClientQuery(["GetAnimeSchedule"]);
            return;
        }

        const ids = Array.isArray(settings.trackedIds)
            ? settings.trackedIds
            : DEFAULT_IDS;

        // We use AniList's public GraphQL API only for metadata/title matching.
        // Seanime's schedule hook needs a title/image/mediaId to render the card.
        const metadata = await fetchAniListMangaMetadata(ids);

        const allItems = [];
        const seen = new Set();

        for (const manga of metadata) {
            try {
                const chapters = await fetchMangaDexReleases(
                    manga,
                    settings.lookaheadDays,
                    settings.language
                );

                for (const chapter of chapters) {
                    const date = new Date(chapter.dateTime);
                    if (isNaN(date.getTime())) continue;

                    const key = `${manga.id}-${chapter.chapter}-${chapter.dateTime}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    allItems.push({
                        mediaId: manga.id,
                        title: chapter.chapter
                            ? `${manga.title} — Ch. ${chapter.chapter}${chapter.volume ? ` (Vol. ${chapter.volume})` : ""}`
                            : manga.title,
                        time: date.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false
                        }),
                        dateTime: date.toISOString(),
                        image: manga.image,
                        episodeNumber: parseFloat(chapter.chapter) || 0,
                        isMovie: false,
                        isSeasonFinale: false
                    });
                }
            } catch (error) {
                console.error(`Manga Release Schedule: failed ${manga.title}`, error);
            }
        }

        allItems.sort((a, b) =>
            new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
        );

        $store.set("manga-release-schedule-items", allItems);
        $storage.set("manga-release-schedule-items", allItems);
        $app.invalidateClientQuery(["GetAnimeSchedule"]);
    }

    async function fetchAniListMangaMetadata(ids) {
        if (!ids || ids.length === 0) return [];

        const query = `
            query ($ids: [Int]) {
                Page(perPage: 50) {
                    media(id_in: $ids, type: MANGA) {
                        id
                        title {
                            romaji
                            english
                            native
                        }
                        coverImage {
                            medium
                            large
                        }
                    }
                }
            }
        `;

        const response = await fetchWithJson(
            "https://graphql.anilist.co",
            "POST",
            {
                query: query,
                variables: { ids: ids }
            },
            { "Content-Type": "application/json", "Accept": "application/json" }
        );

        const media = response?.data?.Page?.media || [];

        return media.map(item => ({
            id: item.id,
            title: item.title?.english || item.title?.romaji || item.title?.native || `Manga ${item.id}`,
            image: item.coverImage?.large || item.coverImage?.medium || ""
        }));
    }

    async function fetchMangaDexReleases(manga, lookaheadDays, language) {
        // Search MangaDex by title.
        const searchUrl =
            "https://api.mangadex.org/manga" +
            `?title=${encodeURIComponent(manga.title)}` +
            "&limit=5" +
            "&contentRating[]=safe" +
            "&contentRating[]=suggestive" +
            "&order[relevance]=desc";

        const search = await ctxFetchJson(searchUrl);
        const candidates = Array.isArray(search?.data) ? search.data : [];

        if (candidates.length === 0) return [];

        // Prefer an exact/near-exact title match.
        const wanted = normalizeTitle(manga.title);
        candidates.sort((a, b) => {
            const at = normalizeTitle(getMangaDexTitle(a));
            const bt = normalizeTitle(getMangaDexTitle(b));
            const as = at === wanted ? 0 : levenshtein(at, wanted);
            const bs = bt === wanted ? 0 : levenshtein(bt, wanted);
            return as - bs;
        });

        const mdx = candidates[0];
        if (!mdx?.id) return [];

        const since = new Date();
        const until = new Date(Date.now() + lookaheadDays * 86400000);

        let url =
            `https://api.mangadex.org/manga/${mdx.id}/feed` +
            `?limit=100` +
            `&order[publishAt]=asc` +
            `&includeFuturePublishAt=1` +
            `&publishAtSince=${encodeURIComponent(since.toISOString())}`;

        if (language !== "all") {
            url += `&translatedLanguage[]=${encodeURIComponent(language)}`;
        }

        const feed = await ctxFetchJson(url);
        const rows = Array.isArray(feed?.data) ? feed.data : [];

        return rows
            .map(row => {
                const attr = row?.attributes || {};
                return {
                    chapter: attr.chapter || "",
                    volume: attr.volume || "",
                    dateTime: attr.publishAt || attr.readableAt || attr.createdAt
                };
            })
            .filter(row => {
                const time = new Date(row.dateTime).getTime();
                return !isNaN(time) && time >= since.getTime() && time <= until.getTime();
            });
    }

    async function fetchWithJson(url, method, body, headers) {
        const response = await ctx.fetch(url, {
            method: method,
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from ${url}`);
        }

        return response.json();
    }

    async function ctxFetchJson(url) {
        const response = await ctx.fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from ${url}`);
        }
        return response.json();
    }

    function getMangaDexTitle(item) {
        const title = item?.attributes?.title || {};
        return title.en || title["ja-ro"] || Object.values(title)[0] || "";
    }

    function normalizeTitle(value) {
        return $toString(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function levenshtein(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
                    ? matrix[i - 1][j - 1]
                    : Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + 1
                    );
            }
        }
        return matrix[b.length][a.length];
    }
}

init();
