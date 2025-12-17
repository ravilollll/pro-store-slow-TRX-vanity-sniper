import { WebSocket } from 'undici';
import http2 from 'http2';
import { readFileSync, watch } from 'fs';

const T = "claim token";
const G = "guild id";
const CH = "channel id";

let M = "";
let TOKENS = [];
const V = new Map();
const B = new Map();
let C = null;
const WS = [];

const SP = Buffer.from('eyJicm93c2VyIjoiYSIsImJyb3dzZXJfdXNlcl9hZ2VudCI6ImEiLCJjbGllbnRfYnVtbNC0X251bWJlciI6MX0=');
const PATH = Buffer.from(`/api/v9/guilds/${G}/vanity-url`);
const AUTH = Buffer.from(T);

const H_BASE = {
    ':method': 'PATCH',
    ':scheme': 'https',
    ':authority': 'canary.discord.com',
    'authorization': T,
    'content-type': 'application/json',
    'user-agent': '0',
    'x-super-properties': SP.toString()
};

function ld() {
    try {
        const d = readFileSync('list.txt', 'utf8');
        TOKENS = d.split('\n').filter(t => t.trim().length > 20);
        console.log(`${TOKENS.length} tokens`);
    } catch {
        TOKENS = [];
    }
}

function prep(c) {
    const j = `{"code":"${c}"}`;
    B.set(c, {
        h: { ...H_BASE, ':path': `/api/v9/guilds/${G}/vanity-url`, 'content-length': j.length },
        b: Buffer.from(j)
    });
}

async function init() {
    if (C) try { C.close(); } catch {}
    
    const { connect } = await import('net');
    const { connect: tls } = await import('tls');
    
    C = http2.connect('https://canary.discord.com', {
        settings: { enablePush: false, initialWindowSize: 2147483647, maxConcurrentStreams: 4294967295 },
        peerMaxConcurrentStreams: 4294967295,
        maxSessionMemory: 8388608,
        createConnection: () => {
            const s = connect({ host: '162.159.135.232', port: 443, noDelay: true, keepAlive: true });
            s.setNoDelay(true);
            return tls({ socket: s, servername: 'canary.discord.com', ALPNProtocols: ['h2'], rejectUnauthorized: false });
        }
    });
    
    C.on('error', () => {});
    C.on('close', () => {});
    C.setMaxListeners(0);
}

function fire(c) {
    const p = B.get(c);
    if (!p) return;
    
    const h = M ? { ...p.h, 'x-discord-mfa-authorization': M } : p.h;
    
    const streams = [];
    for (let i = 0; i < 10; i++) {
        if (!C || C.destroyed) break;
        try {
            const s = C.request(h, { endStream: false, weight: 256 });
            let r = '';
            s.on('data', d => r += d);
            s.on('end', () => {
                if (r) {
                    console.log(`${c}: ${r}`);
                    msg(c, r);
                }
            });
            s.on('error', () => {});
            streams.push(s);
        } catch {}
    }
    
    for (const s of streams) {
        s.end(p.b);
    }
}

function msg(c, r) {
    if (!C || C.destroyed) return;
    
    try {
        const ct = `@everyone /${c}\n\`\`\`json\n${r}\n\`\`\``;
        const pl = Buffer.from(JSON.stringify({ content: ct }));
        
        const h = {
            ':method': 'POST',
            ':path': `/api/v9/channels/${CH}/messages`,
            ':scheme': 'https',
            ':authority': 'canary.discord.com',
            'authorization': T,
            'content-type': 'application/json',
            'user-agent': '0',
            'content-length': pl.length
        };
        
        const m = C.request(h, { endStream: false });
        m.on('error', () => {});
        m.end(pl);
    } catch {}
}

function ws(tk, i) {
    const w = new WebSocket('wss://gateway.discord.gg/?v=9', {
        maxPayload: 52428800
    });
    let ht = null;
    let sq = null;
    
    w.addEventListener('open', () => console.log(`WS${i + 1} up`));
    
    w.addEventListener('close', () => {
        if (ht) clearTimeout(ht);
        setTimeout(() => { WS[i] = ws(tk, i); }, 500);
    });
    
    w.addEventListener('error', () => {});
    
    w.addEventListener('message', ({ data }) => {
        const { t, d: x, op, s } = JSON.parse(data);
        
        if (s) sq = s;
        
        if (t === 'GUILD_UPDATE') {
            const o = V.get(x.guild_id);
            if (o && o !== x.vanity_url_code) {
                console.log(`UPDATE WS${i + 1}: ${x.guild_id} ${o}->${x.vanity_url_code}`);
                fire(o);
                V.set(x.guild_id, x.vanity_url_code);
                prep(x.vanity_url_code);
            }
        } else if (t === 'READY') {
            console.log(`WS${i + 1} ready`);
            for (const g of x.guilds) {
                if (g.vanity_url_code) {
                    V.set(g.id, g.vanity_url_code);
                    prep(g.vanity_url_code);
                }
            }
        } else if (op === 10) {
            const beat = () => {
                if (w.readyState === 1) {
                    w.send(`{"op":1,"d":${sq}}`);
                    ht = setTimeout(beat, x.heartbeat_interval * 0.9);
                }
            };
            ht = setTimeout(beat, x.heartbeat_interval * 0.9);
            w.send(`{"op":2,"d":{"token":"${tk}","intents":1,"properties":{"os":"linux","browser":"chrome","device":""}}}`);
        }
    });
    
    return w;
}

function start() {
    for (const w of WS) {
        try { if (w && w.readyState === 1) w.close(); } catch {}
    }
    WS.length = 0;
    
    for (let i = 0; i < TOKENS.length; i++) {
        setTimeout(() => {
            WS.push(ws(TOKENS[i], i));
        }, i * 3000);
    }
    
    console.log(`Starting ${TOKENS.length} watchers (3s delay each)`);
}

try { M = readFileSync('mfa.txt', 'utf8').trim(); } catch {}

watch('mfa.txt', () => {
    try {
        const n = readFileSync('mfa.txt', 'utf8').trim();
        if (n !== M) {
            M = n;
            for (const [k, v] of B) {
                prep(k);
            }
        }
    } catch {}
});

watch('list.txt', () => {
    ld();
    start();
});

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

ld();
await init();
start();

setInterval(async () => {
    await init();
}, 10000);
