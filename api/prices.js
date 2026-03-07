const fs = require('fs/promises');
const path = require('path');

module.exports = async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'prices-api.json');
    const fileContents = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(fileContents);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to load pricing data',
      details: error.message,
    });
  }
};
