const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');

// Créer un client OAuth2 avec l'ID client Google
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

module.exports = (db) => {
  // Route d'authentification Google
  router.post('/api/auth/google', async (req, res) => {
    try {
      const { token } = req.body;
      
      // Vérifier le token Google
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      
      const payload = ticket.getPayload();
      const googleId = payload.sub;
      const email = payload.email;
      const username = payload.name || email.split('@')[0];
      const profilePicture = payload.picture;
      
      // Vérifier si l'utilisateur existe déjà
      const userQuery = 'SELECT * FROM users WHERE google_id = ? OR email = ?';
      const users = await db.query(userQuery, [googleId, email]);
      
      let userId;
      
      if (users.length === 0) {
        // Créer un nouvel utilisateur
        const insertQuery = `
          INSERT INTO users 
          (username, email, google_id, profile_picture, auth_provider) 
          VALUES (?, ?, ?, ?, 'google')
        `;
        
        const result = await db.query(insertQuery, [username, email, googleId, profilePicture]);
        userId = result.insertId;
      } else {
        // Mettre à jour l'utilisateur existant si nécessaire
        const user = users[0];
        userId = user.id;
        
        // Si l'utilisateur existe mais n'a pas de google_id (s'est inscrit avec email/mot de passe)
        if (!user.google_id) {
          const updateQuery = `
            UPDATE users 
            SET google_id = ?, profile_picture = ?, auth_provider = 'google' 
            WHERE id = ?
          `;
          
          await db.query(updateQuery, [googleId, profilePicture, userId]);
        }
      }
      
      // Récupérer les informations complètes de l'utilisateur
      const getUserQuery = 'SELECT id, username, email, profile_picture FROM users WHERE id = ?';
      const userResults = await db.query(getUserQuery, [userId]);
      const userData = userResults[0];
      
      // Définir la session utilisateur
      req.session.user = {
        id: userData.id,
        email: userData.email,
        username: userData.username
      };
      
      res.status(200).json({
        message: 'Authentification Google réussie',
        user: userData
      });
    } catch (error) {
      console.error('Erreur d\'authentification Google:', error);
      res.status(500).json({ error: 'Erreur d\'authentification Google' });
    }
  });
  
  return router;
};