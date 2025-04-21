const express = require('express');

module.exports = (db) => {
const router = express.Router();

// Fonction pour générer un code unique pour l'événement
const generateUniqueEventCode = (userId) => {
  const prefix = 'EV';
  const timestamp = Date.now().toString(36);
  const randomNum = Math.floor(Math.random() * 1000).toString(36);
  return `${userId}${prefix}${timestamp}${randomNum}`.toUpperCase();
};

// Créer un nouvel événement
router.post('/api/events', async (req, res) => {
  try {
    const { name, startDate, endDate, currency, participants, userId } = req.body;

    // Valider les données d'entrée
    if (!name || !startDate || !endDate || !currency || !participants || !Array.isArray(participants)) {
      return res.status(400).json({ error: 'Données d\'entrée invalides' });
    }

    // Générer un code unique pour l'événement
    const eventCode = generateUniqueEventCode(userId);

    // Insérer l'événement
    const insertEventQuery = `
      INSERT INTO events (name, start_date, end_date, currency, created_by, code)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    try {
      const result = await db.query(insertEventQuery, [name, startDate, endDate, currency, userId, eventCode]);
      const eventId = result.insertId;

      // Ajouter les participants
      const insertParticipantQuery = 'INSERT INTO participants (event_id, name, user_id) VALUES (?, ?, ?)';
      const participantPromises = participants.map(participant =>
        db.query(insertParticipantQuery, [eventId, participant.name, participant.id || null])
      );

      await Promise.all(participantPromises);
      res.json({
        id: eventId,
        code: eventCode,
        message: 'Événement créé avec succès'
      });
    } catch (error) {
      console.error('Erreur lors de la création de l\'événement:', error);
      res.status(500).json({ error: 'Erreur lors de la création de l\'événement' });
    }
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Récupérer les participants d'un événement par code
router.get('/api/events/by-code/:eventCode/participants', async (req, res) => {
  try {
    const { eventCode } = req.params;
    const balanceService = require('../services/balanceService');
    const participants = await db.query(`SELECT * FROM participants WHERE event_id = (SELECT id FROM events WHERE code = ?)`, [eventCode]);
    res.json(participants);
  } catch (error) {
    console.error('Erreur lors de la récupération des participants par code:', error);
    res.status(404).json({ error: "Événement introuvable ou erreur serveur" });
  }
});
return router;
};