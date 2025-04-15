const express = require('express');
const app = express();
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const session = require('express-session');
const expenseRoutes = require('./routes/expenseRoutes');
const eventRoutes = require('./routes/eventRoutes');
const routes = require('./routes');

const port = 8081;

app.use(express.json());

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie'],
  exposedHeaders: ['Set-Cookie'],
  preflightContinue: true,
  optionsSuccessStatus: 200
}));

app.use('/api/expenses', expenseRoutes);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  },
  rolling: true,
  name: 'sessionId'
}));

// Session logging middleware
app.use((req, res, next) => {
 /* console.log('\n=== Session Information ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  console.log('Cookie Settings:', req.session.cookie);
  console.log('=========================\n');*/
  next();
});

/*// Authentication middleware
const authenticateUser = (req, res, next) => {
  if (!req.session || !req.session.user || !req.session.user.id) {
    console.log('Authentication failed - Invalid session or user data');
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};*/

// Session logging middleware
app.use((req, res, next) => {
  /*console.log('\n=== Session Information ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  console.log('Cookie Settings:', req.session.cookie);
  console.log('=========================\n');*/
  next();
});

// MySQL connection configuration
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Initialize routes
app.use(routes(db));

// Get user data endpoint
app.get('/api/user-data', async (req, res) => {
  try {
    if (!req.session || !req.session.user || !req.session.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.id;
    const query = 'SELECT id, username, email FROM users WHERE id = ?';
    
    db.query(query, [userId], (error, results) => {
      if (error) {
        console.error('Error fetching user data:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const userData = results[0];
      res.json(userData);
    });
  } catch (error) {
    console.error('Error in user data endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Create event endpoint
app.post('/api/events', async (req, res) => {
  try {
    const { name, startDate, endDate, currency, splitType, participants, created_by } = req.body;
    const userId = req.query.userId;
    // Validate required fields
    if (!name || !created_by) {
      return res.status(400).json({ error: 'Event name and user ID are required' });
    }
    const generateUniqueEventCode = () => {
      const prefix = 'EV';
      const timestamp = Date.now().toString(36);
      const randomNum = Math.floor(Math.random() * 1000).toString(36);
      return `${created_by}${prefix}${timestamp}${randomNum}`.toUpperCase();
    };
    const eventCode = generateUniqueEventCode();
    // Insert event with created_by from request body
    const eventQuery = 'INSERT INTO events (name, start_date, end_date, currency, split_type, created_by,code) VALUES (?, ?, ?, ?, ?, ?,?)';
    db.query(eventQuery, [name, startDate, endDate, currency, splitType, created_by,eventCode], (err, result) => {
      if (err) {
        console.error('Error creating event:', err);
        return res.status(500).json({ error: 'Error creating event' });
      }

      const eventId = result.insertId;

      // Prepare participants array with valid participants only
      const validParticipants = participants && participants.length > 0 
        ? participants.filter(p => p.name && p.name.trim())
        : [];

      // Insert valid participants
      if (validParticipants.length === 0) {
        return res.status(400).json({ error: 'At least one valid participant is required' });
      }

      // Get username for the logged-in user
      const userQuery = 'SELECT username FROM users WHERE id = ?';
      db.query(userQuery, [created_by], (userErr, userResults) => {
        if (userErr) {
          console.error('Error fetching user data:', userErr);
          return res.status(500).json({ error: 'Error fetching user data' });
        }

        const loggedInUsername = userResults[0]?.username;

        // Insert participants one by one to get their IDs
        const participantQuery = 'INSERT INTO participants (event_id, name, custom_amount, user_id) VALUES (?, ?, ?, ?)';
        // Create participant promises with proper indentation and structure
        const participantPromises = validParticipants.map(p => {
          // Check if this participant matches the logged-in user's username
          const isLoggedInUser = loggedInUsername && p.name.trim() === loggedInUsername;
          
          return new Promise((resolve, reject) => {
            db.query(participantQuery, [
              eventId, 
              p.name.trim(), 
              p.customAmount || null, 
              isLoggedInUser ? created_by : null
            ], (err, result) => {
              if (err) {
                reject(err);
              } else {
                resolve({ 
                  id: result.insertId, 
                  name: p.name.trim(),
                  user_id: isLoggedInUser ? created_by : null
                });
              }
            });
          });
        });
        
        Promise.all(participantPromises)
        .then(insertedParticipants => {
          res.status(201).json({
            message: 'Event created successfully',
            eventId,
            participants: insertedParticipants
          });
        })
        .catch(err => {
          console.error('Error adding participants:', err);
          res.status(500).json({ error: 'Error adding participants' });
        });
    });
  });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Error creating event' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Compare password
      const match = await bcrypt.compare(password, results[0].password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Store user data in session
      req.session.user = {
        id: results[0].id,
        email: results[0].email,
        username: results[0].username
      };

      res.json({ message: 'Login successful', user: { id: results[0].id, email: results[0].email, username: results[0].username } });
    });
  } catch (error) {  // Removed the comma before catch
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register endpoint
// User session verification endpoint
/*app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.session.user.id,
    email: req.session.user.email,
    username: req.session.user.username
  });
});
*/
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Validate input
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const checkQuery = 'SELECT * FROM users WHERE email = ?';
    db.query(checkQuery, [email], async (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length > 0) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      const insertQuery = 'INSERT INTO users (email, password, username) VALUES (?, ?, ?)';
      db.query(insertQuery, [email, hashedPassword, username], (err, result) => {
        if (err) {
          console.error('Error creating user:', err);
          return res.status(500).json({ error: 'Error creating user' });
        }

        // Store user data in session
        req.session.user = {
          id: result.insertId,
          email: email,
          username: username
        };

        res.status(201).json({ message: 'User registered successfully' });
      });
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's events endpoint
app.get('/api/user-events', (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  const query = `
    SELECT DISTINCT e.*, 
      GROUP_CONCAT(DISTINCT p.name) as participant_names,
      GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
      COUNT( DISTINCT ex.id) as expenseCount,  -- Count of expenses
      COALESCE(SUM(ex.amount) / NULLIF(COUNT(DISTINCT p.id), 0), 0) as totalExpenseAmount  -- Sum of expense amounts
    FROM events e
    LEFT JOIN participants p ON e.id = p.event_id
    LEFT JOIN expenses ex ON e.id = ex.event_id  -- Join with expenses table
    WHERE e.created_by = ? 
      OR EXISTS (SELECT 1 FROM participants p2 WHERE p2.event_id = e.id AND p2.name = (SELECT username FROM users WHERE id = ?))
    GROUP BY e.id
    ORDER BY e.created_at DESC
  `;

  db.query(query, [userId, userId], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Log query results
    //console.log('Query Results:', results);
    // Process the results to format participant data
    const formattedResults = results.map(event => ({
      ...event,
      participants: event.participant_names
        ? event.participant_names.split(',').map((name, index) => ({
            name,
            customAmount: event.participant_amounts
              ? event.participant_amounts.split(',')[index] || null
              : null
          })).filter(p => p.name && p.name.trim()) // Filter out null or blank usernames
        : [],
    }));

    res.json(formattedResults);
  });
});

// Get expense participants endpoint
app.get('/api/expense-participants/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;

    if (!expenseId) {
      return res.status(400).json({ error: 'Expense ID is required' });
    }

    const query = `
      SELECT ep.*, e.description as expense_description, e.amount as expense_amount, e.split_type
      FROM expense_participants ep
      JOIN expenses e ON ep.expense_id = e.id
      WHERE ep.expense_id = ?
    `;

    db.query(query, [expenseId], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'No participants found for this expense' });
      }

      res.json(results);
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create expense endpoint
app.post('/api/expenses', async (req, res) => {
  try {
    const { description, amount, groupId, paidBy, createdDate, split_type, selectedParticipants, customAmounts, shares, receiptImage } = req.body;

    // Validate required fields
    if (!description || !amount || !paidBy || !split_type || !selectedParticipants) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format the date to MySQL compatible format (YYYY-MM-DD)
    const formattedDate = new Date(createdDate).toISOString().split('T')[0];

    // Insert expense
    const expenseQuery = 'INSERT INTO expenses (description, amount, event_id, paid_by, created_date, split_type, receipt_image) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(expenseQuery, [description, amount, groupId, paidBy, formattedDate, split_type, receiptImage], (err, result) => {
      if (err) {
        console.error('Error creating expense:', err);
        return res.status(500).json({ error: 'Error creating expense' });
      }

      const expenseId = result.insertId;

      // Get valid participant IDs from the participants table
      const participantQuery = 'SELECT id, name FROM participants WHERE event_id = ? AND name IN (?)';
      const participantNames = selectedParticipants
        .filter(p => p && typeof p === 'string' && p.trim())
        .map(p => p.trim());

      if (participantNames.length === 0) {
        return res.status(400).json({ error: 'No valid participants selected' });
      }

      console.log('Executing participant query:', participantQuery);
      console.log('Query parameters:', { groupId, participantNames });
      
      db.query(participantQuery, [groupId, participantNames], (err, participantResults) => {
        if (err) {
          console.error('Error fetching participant IDs:', err);
          return res.status(500).json({ error: 'Error fetching participant IDs' });
        }
        
        console.log('Participant query results:', participantResults);

        const validParticipants = participantResults.filter(participant => 
          participantNames.includes(participant.name)
        );

        if (validParticipants.length === 0) {
          return res.status(400).json({ error: 'No valid participants found' });
        }

        const participantValues = validParticipants.map(participant => {
          let shareAmount;
          if (split_type === 'equal') {
            shareAmount = amount / validParticipants.length;
          } else if (split_type === 'custom') {
            shareAmount = parseFloat(customAmounts[participant.name] || '0');
            if (isNaN(shareAmount) || shareAmount < 0) {
              shareAmount = amount / validParticipants.length;
            }
          } else { // shares
            let participantShare = parseFloat(shares[participant.name] || '1');
            if (isNaN(participantShare) || participantShare <= 0) {
              participantShare = 1;
            }
            
            const totalShares = validParticipants.reduce((sum, p) => {
              const shareValue = parseFloat(shares[p.name] || '1');
              return sum + (isNaN(shareValue) || shareValue <= 0 ? 1 : shareValue);
            }, 0);
            
            shareAmount = (amount * participantShare) / totalShares;
          }
          
          shareAmount = parseFloat(shareAmount.toFixed(2));
          if (isNaN(shareAmount) || shareAmount <= 0) {
            shareAmount = amount / validParticipants.length;
          }
          
          return [expenseId, participant.id, shareAmount];
        })

        // Ensure the total equals the amount by adjusting if necessary
        const totalShareAmount = participantValues.reduce((sum, value) => sum + value[2], 0);
        if (Math.abs(totalShareAmount - amount) > 0.01) {
          const diff = amount - totalShareAmount;
          const smallAdjustment = parseFloat((diff / participantValues.length).toFixed(2));
          
          participantValues.forEach((value, index) => {
            if (index === participantValues.length - 1) {
              const currentTotal = participantValues.reduce((sum, v, i) => i < index ? sum + v[2] : sum, 0);
              value[2] = parseFloat((amount - currentTotal).toFixed(2));
            } else {
              value[2] = parseFloat((value[2] + smallAdjustment).toFixed(2));
            }
          });
        }

        // Vérifier que tous les montants sont positifs
        if (participantValues.some(([_, __, amount]) => amount <= 0)) {
          return res.status(400).json({ error: 'Invalid share amounts calculated' });
        }

        // Vérifier que la somme des parts est égale au montant total
        const totalShares = participantValues.reduce((sum, [_, __, amount]) => sum + amount, 0);
        if (Math.abs(totalShares - amount) > 0.01) {
          return res.status(400).json({ error: 'Total shares do not match expense amount' });
        }

        const participantInsertQuery = 'INSERT INTO expense_participants (expense_id, participant_id, share_amount) VALUES ?';
        db.query(participantInsertQuery, [participantValues], (err) => {
          if (err) {
            console.error('Error adding expense participants:', err);
            return res.status(500).json({ error: 'Error adding expense participants' });
          }
          res.status(201).json({
            message: 'Expense created successfully',
            expenseId,
            totalAmount: amount,
            shares: participantValues.map(([_, participantId, shareAmount]) => ({
              participantId,
              shareAmount
            }))
          });
        });
      });
    });
  } 
  catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});