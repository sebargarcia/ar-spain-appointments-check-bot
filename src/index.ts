import * as cheerio from 'cheerio';

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	TELEGRAM_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

const url = 'https://www.cgeonline.com.ar/informacion/apertura-de-citas.html';

const CITA_CONSULAR_BASE = 'https://www.citaconsular.es';
const CITA_CONSULAR_WIDGET_PATH = '/es/hosteds/widgetdefault/298f7f17f58c0836448a99edecf16e66a';
const CITA_CONSULAR_PUBLIC_KEY = '298f7f17f58c0836448a99edecf16e66a';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
	'User-Agent': BROWSER_UA,
	'Accept': 'text/html',
	'Accept-Language': 'es',
	'Referer': CITA_CONSULAR_BASE + '/',
};

function extractSessionCookie(response: { headers: { get(name: string): string | null } }): string | null {
	const setCookie = response.headers.get('set-cookie');
	if (!setCookie) return null;
	const match = setCookie.match(/PHPSESSID=([^;]+)/);
	return match ? match[1] : null;
}

async function checkCitaConsularAvailability(): Promise<{ available: boolean; message: string }> {
	// Step 1: GET the captcha page to get the CSRF token and session cookie
	const step1Res = await fetch(CITA_CONSULAR_BASE + CITA_CONSULAR_WIDGET_PATH, {
		headers: BROWSER_HEADERS,
		redirect: 'follow',
	});
	const step1Html = await step1Res.text();

	if (!step1Html) {
		return { available: false, message: 'Error: servidor devolvió respuesta vacía en paso 1' };
	}

	const tokenMatch = step1Html.match(/name="token" value="([^"]+)"/);
	if (!tokenMatch) {
		return { available: false, message: 'Error: no se encontró token CSRF' };
	}
	const token = tokenMatch[1];
	const sessionId = extractSessionCookie(step1Res);

	if (!sessionId) {
		return { available: false, message: 'Error: no se recibió cookie de sesión' };
	}

	// Step 2: POST the token to pass the captcha gate
	const step2Res = await fetch(CITA_CONSULAR_BASE + CITA_CONSULAR_WIDGET_PATH + '/', {
		method: 'POST',
		headers: {
			...BROWSER_HEADERS,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Referer': CITA_CONSULAR_BASE + CITA_CONSULAR_WIDGET_PATH,
			'Cookie': `PHPSESSID=${sessionId}`,
		},
		body: `token=${token}`,
		redirect: 'follow',
	});
	await step2Res.text();

	const sessionId2 = extractSessionCookie(step2Res) || sessionId;

	// Step 3: Fetch the JSONP widget content
	const jsonpUrl = `${CITA_CONSULAR_BASE}/onlinebookings/main/?callback=cb&type=default&publickey=${CITA_CONSULAR_PUBLIC_KEY}&lang=es&version=3&src=x`;
	const step3Res = await fetch(jsonpUrl, {
		headers: {
			...BROWSER_HEADERS,
			'Referer': CITA_CONSULAR_BASE + CITA_CONSULAR_WIDGET_PATH + '/',
			'Cookie': `PHPSESSID=${sessionId2}`,
		},
		redirect: 'follow',
	});
	const jsonpRaw = await step3Res.text();

	if (!jsonpRaw) {
		return { available: false, message: 'Error: respuesta JSONP vacía' };
	}

	// Parse JSONP: cb("...escaped html...");
	let widgetHtml: string;
	try {
		const start = jsonpRaw.indexOf('("') + 2;
		const end = jsonpRaw.lastIndexOf('");');
		widgetHtml = JSON.parse('"' + jsonpRaw.substring(start, end) + '"');
	} catch {
		return { available: false, message: 'Error: no se pudo parsear respuesta JSONP' };
	}

	if (!widgetHtml) {
		return { available: false, message: 'Error: contenido del widget vacío' };
	}

	const noAppointments = widgetHtml.includes('No hay horas disponibles');
	if (noAppointments) {
		return { available: false, message: 'No hay citas disponibles en citaconsular.es' };
	}

	return {
		available: true,
		message: `¡HAY CITAS DISPONIBLES en citaconsular.es!\n\nRevisá: ${CITA_CONSULAR_BASE}${CITA_CONSULAR_WIDGET_PATH}`,
	};
}

async function findNextOpenPassportDates() {
	const res = await fetch(url);
	const text = await res.text();
	const $ = cheerio.load(text);

	let passportRow: any = null;
	$('table tr').each((index, element) => {
		const rowText = $(element).text().trim();
		if (rowText.includes('Pasaportes') && rowText.includes('renovación y primera vez')) {
			passportRow = $(element);
		}
	});

	if (!passportRow) {
		return [];
	}

	const passportRowValues: string[] = passportRow
		.find('td')
		.map((index: number, element: cheerio.Element) => $(element).text().trim())
		.get();

	return passportRowValues;
}

function formatInfo(info: string[]): string {
	//[0] Tipo de trámite
	//[1] Ultima fecha de apertura de turnos
	//[2] Proximos turnos

	if (info.length === 0) {
		return 'No hay información disponible';
	}

	const message = `
		Pasaportes renovcaión y primera vez:
		------------------------------------

		- Ultima fecha de apertura de turnos: ${info[1]}
		- Proximos turnos: ${info[2]}
	`;

	return message;
}

/**
 * Sends a Telegram response to the specified chat ID with the given message.
 * @param {string} chatId - The chat ID where the message will be sent.
 * @param {string} message - The message to send.
 * @returns {Response} - The response from the Telegram API.
 */
async function sendTelegramResponse(env: Env, chatId: string, message: string) {
	const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
	const params = {
		chat_id: chatId,
		text: message,
	};

	try {
		const response = await fetch(telegramUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(params),
		});

		if (response.ok) {
			return new Response(`Message sent successfully! ${message}`, { status: 200 });
		} else {
			return new Response('Failed to send message.', { status: 500 });
		}
	} catch (error) {
		console.error(error);
		return new Response('Error occurred while sending the message.', { status: 500 });
	}
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		// No consultar en consulado bs as, solo en citaconsular.es
		// const openDates = await findNextOpenPassportDates();
		// //Check if there are open dates only
		// if (openDates.length > 0 && openDates[2] === 'fecha por confirmar') {
		// 	return;
		// }

		// await sendTelegramResponse(env, env.TELEGRAM_CHAT_ID, formatInfo(openDates));

		// Check citaconsular.es for available appointments
		try {
			const citaResult = await checkCitaConsularAvailability();
			if (citaResult.available) {
				await sendTelegramResponse(env, env.TELEGRAM_CHAT_ID, citaResult.message);
			}
		} catch (e) {
			console.error('Error checking citaconsular.es:', e);
		}
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { method, headers } = request;
		const url = new URL(request.url);

		// Check if the request is a POST request to /webhooks/telegram and has JSON content-type
		if (method === 'POST' && url.pathname == '/webhooks/telegram' && headers.get('content-type') === 'application/json') {
			const data: any = await request.json();
			const { message } = data;

			if (message && message.text) {
				const command = message.text.trim();

				if (command.startsWith('/consultarcita')) {
					const chatId = message.chat.id;
					try {
						const citaResult = await checkCitaConsularAvailability();
						sendTelegramResponse(env, chatId, citaResult.message);
						return new Response('Cita consultada correctamente', { status: 200 });
					} catch (e) {
						await sendTelegramResponse(env, chatId, 'Error al consultar citaconsular.es');
						await sendTelegramResponse(env, chatId, e.message);
						return new Response('Error al consultar citaconsular.es', { status: 500 });
					}
				}

				if (command.startsWith('/consultar')) {
					const openDates = await findNextOpenPassportDates();
					const chatId = message.chat.id;
					return sendTelegramResponse(env, chatId, formatInfo(openDates));
				}
			}
		}

		return new Response(`Buenos Aires Spanish passport check telegram bot @spain-bsas-passport-checker`);
	},
};
