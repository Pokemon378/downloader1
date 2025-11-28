export default {
    async fetch(request) {
        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
            });
        }

        if (request.method === "POST") {
            try {
                const { url } = await request.json();

                // Use Cobalt API (Free, No Ads, Reliable)
                const api = "https://cobalt.meowing.de/";

                const response = await fetch(api, {
                    method: "POST",
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        url: url,
                        videoQuality: "1080",
                        audioFormat: "mp3",
                        downloadMode: "auto"
                    })
                });

                const result = await response.json();

                return new Response(JSON.stringify(result), {
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                });
            } catch (err) {
                return new Response(JSON.stringify({ status: "error", text: "Failed to fetch from API: " + err.message }), {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                });
            }
        }

        return new Response("API Running", {
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}
