const express = require('express');
const router = express.Router();

// Fonction pour générer un code unique pour l'événement
const generateUniqueEventCode = () => {
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
    const eventCode = generateUniqueEventCode();

    // Insérer l'événement
    const insertEventQuery = `
      INSERT INTO events (name, start_date, end_date, currency, created_by, code)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
      insertEventQuery,
      [name, startDate, endDate, currency, userId, eventCode],
      async (err, result) => {
        if (err) {
          console.error('Erreur de base de données:', err);
          return res.status(500).json({ error: 'Erreur de base de données' });
        }

        const eventId = result.insertId;

        // Ajouter les participants
        const participantPromises = participants.map(
          participant =>
            new Promise((resolve, reject) => {
              const insertParticipantQuery =
                'INSERT INTO participants (event_id, name, user_id) VALUES (?, ?, ?)';
              db.query(
                insertParticipantQuery,
                [eventId, participant.name, participant.id || null],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            })
        );

        try {
          await Promise.all(participantPromises);
          res.json({
            id: eventId,
            code: eventCode,
            message: 'Événement créé avec succès'
          });
        } catch (error) {
          console.error('Erreur lors de l\'ajout des participants:', error);
          res.status(500).json({ error: 'Échec de l\'ajout des participants' });
        }
      }
    );
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;