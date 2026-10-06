// Data shape for each tracked manga
interface MangaScheduleEntry {
    mediaId: number
    title: string
    coverImage: string
    nextChapter: number
    nextReleaseDate: string // ISO date string
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'irregular'
    anilistStatus: string // CURRENT, etc.
}

function init() {
    // Hook into manga collection requests to cache your list
    // Note: check if onGetMangaCollection exists in your Seanime version
    // If not, use ctx.manga.getCollection() inside the UI context instead
    
    $ui.register((ctx) => {
        // Persistent storage for schedule entries
        const schedules = ctx.state<Record<number, MangaScheduleEntry>>(
            $storage.get<Record<number, MangaScheduleEntry>>('manga-schedules') || {}
        )

        // Auto-save whenever schedules change
        ctx.effect(() => {
            $storage.set('manga-schedules', schedules.get())
        }, [schedules])

        // --- CRON: Daily reminder check ---
        ctx.cron.add('manga-release-check', '@daily', () => {
            const today = new Date().toISOString().split('T')[0]
            const upcoming = Object.values(schedules.get())
                .filter(s => s.nextReleaseDate === today)

            if (upcoming.length > 0) {
                const titles = upcoming.map(s => s.title).join(', ')
                ctx.toast.info(`Manga releasing today: ${titles}`)
            }
        })
        ctx.cron.start()

        // --- WEBVIEW: Monthly calendar view ---
        const tracker = ctx.newWebview({
            slot: 'screen',
            fullWidth: true,
            autoHeight: true,
            sidebar: {
                label: 'Manga Schedule',
                icon: 'calendar' // check available icons in docs
            }
        })

        // Sync schedules to the webview
        tracker.channel.sync('schedules', schedules)

        // Handle "add schedule" from webview
        tracker.channel.on('add-schedule', (entry: MangaScheduleEntry) => {
            schedules.set(prev => ({ ...prev, [entry.mediaId]: entry }))
            ctx.toast.success(`Added ${entry.title} to schedule`)
        })

        // Handle "remove schedule"
        tracker.channel.on('remove-schedule', (mediaId: number) => {
            schedules.set(prev => {
                const next = { ...prev }
                delete next[mediaId]
                return next
            })
        })

        // Render the calendar UI
        tracker.setContent(() => {
            // This is where you build the monthly calendar HTML/Preact
            return generateCalendarHTML(schedules.get())
        })

        // --- ACTION BUTTON: On manga detail pages ---
        const addButton = ctx.action.newMangaPageButton({
            label: 'Track Release',
            intent: 'primary'
        })
        addButton.mount()
        addButton.onClick((event) => {
            const manga = event.media
            // Open a small dialog or webview to set frequency + date
            // For simplicity, we'll default to weekly from today
            const nextDate = new Date()
            nextDate.setDate(nextDate.getDate() + 7)
            
            schedules.set(prev => ({
                ...prev,
                [manga.id]: {
                    mediaId: manga.id,
                    title: manga.title.userPreferred,
                    coverImage: manga.coverImage?.large || '',
                    nextChapter: 1, // user will edit
                    nextReleaseDate: nextDate.toISOString().split('T')[0],
                    frequency: 'weekly',
                    anilistStatus: manga.mediaListEntry?.status || 'CURRENT'
                }
            }))
            ctx.toast.success(`Tracking ${manga.title.userPreferred}`)
        })
    })
}

// Helper: generate the calendar HTML (use Preact inside for interactivity)
function generateCalendarHTML(schedules: Record<number, MangaScheduleEntry>): string {
    // Build a monthly grid. For each day, find schedules whose
    // nextReleaseDate falls on that day, OR whose projected recurrence
    // (based on frequency) would land on that day.
    //
    // Projection logic:
    // - weekly: add 7 days repeatedly
    // - biweekly: add 14 days
    // - monthly: add ~30 days (or use proper month math)
    // - irregular: only show the single set date
    //
    // Return HTML string with styling
    return `<!DOCTYPE html>
<html>
<head><style>/* your calendar styles */</style></head>
<body>
    <div id="calendar"></div>
    <script>
        // Preact component that receives 'schedules' via window.webview.on
    </script>
</body>
</html>`
}