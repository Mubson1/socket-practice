const env = process.env;

export const envVariables = {
  port: env.PORT || 3000,
};

export const dbQuery = {
  createMessageTable: `
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
    );
  `,
  storeInMessageTable:
    "INSERT INTO messages (content, client_offset) VALUES (?, ?)",
  getLatestMessageContentAfterOffset:
    "SELECT id, content FROM messages WHERE id > ?",
};
