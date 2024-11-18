# Mailcow Status Tracker

This is a Node.js-based application for tracking and processing email logs from a Mailcow server. It fetches logs, stores them in a SQLite database, and provides a web interface and API endpoints for viewing email statuses. It supports triggering external webhooks to notify other servers with the status updates.

![Table showing example logs](docs/logs-screenshot.png)

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/hacktisch/mailcow-status-tracker.git
   cd mailcow-status-tracker
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   - Create a `.env` file in the root directory.
   - Copy the contents of `.env.example`:
     ```bash
     cp .env.example .env
     ```
   - Update the variables in `.env` to match your setup.

## Environment Variables

| Variable         | Description                                                   | Example Value                                    |
|-------------------|---------------------------------------------------------------|-------------------------------------------------|
| `API_KEY`        | API key for accessing Mailcow logs. Obtain one at `https://mail.example.com/admin` by expanding the "API [+]" section.accordeon.                         | `000000-000000-000000-000000-000000`            |
| `API_URL_BASE`   | Base URL for the API of your Mailcow instance.                            | `https://mail.example.com/api/v1/get/logs/postfix` |
| `WEBHOOK`        | Webhook URL for sending status updates.                      | `https://www.example.com/mail-webhook`          |
| `LOGS_PER_BATCH` | Number of logs to fetch per batch.                           | `100`                                           |
| `CRON_SCHEDULE`  | Cron schedule for periodic synchronization.                  | `* * * * *`                                     |
| `PORT`           | Port for the Express server.                                 | `3005`                                          |

## Usage

1. **Start the Server**:
   ```bash
   npm start
   ```
   or for development:
   ```bash
   npm run dev
   ```

2. **Access the Dashboard**:
   Open your browser and navigate to:
   ```
   http://localhost:3005
   ```
   The dashboard displays the latest 100 log entries and automatically triggers the sync function before loading the data.

3. **API Endpoints**:
   - **Fetch Logs by Message ID**:
     ```http
     GET /message?message_id=<MESSAGE_ID>
     ```

   - **Manually Trigger Sync**:
     ```http
     GET /sync-logs
     ```

## Customize Cron Schedule
   - Update `CRON_SCHEDULE` in `.env` to adjust synchronization frequency.
   - Example (run every 10 minutes):
     ```plaintext
     CRON_SCHEDULE="*/10 * * * *"
     ```
   - Ensure that `LOGS_PER_BATCH` exceeds the number of log entries generated within each cron interval to avoid missing logs.

## Deployment

Use a process manager like [PM2](https://pm2.keymetrics.io/) or Docker to run the app persistently.

## License

MIT