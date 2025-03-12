const http = require('http');
const net = require('net');
const url = require('url');
const querystring = require('querystring');

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    const queryParams = querystring.parse(parsedUrl.query);
    const targetIp = queryParams.ip;
    const targetPort = queryParams.port;

    console.log(`Proxying request to: ${targetIp}:${targetPort}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const client = new net.Socket();
    let responseData = '';

    client.setTimeout(5000); // Set timeout (5 seconds)

    client.connect(targetPort, targetIp, () => {
        console.log('Connected to GPS2IP, requesting data...');
        client.write('GET /?request=live\r\n');  // Send request manually
    });

    client.on('data', (data) => {
        responseData += data.toString();
        console.log('Received GPS Data:', responseData);
        client.end(); // Close connection after receiving data
    });

    client.on('end', () => {
        console.log('Connection ended. Sending response...');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(responseData || 'No data received');
    });

    client.on('timeout', () => {
        console.error('Connection timed out!');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Connection timed out');
        client.destroy();
    });

    client.on('error', (err) => {
        console.error('Socket Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to fetch GPS data');
        client.destroy();
    });

    client.on('close', () => {
        console.log('Connection closed.');
    });
});

server.listen(3000, () => {
    console.log('Proxy server running on http://localhost:3000');
});