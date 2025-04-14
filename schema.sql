-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  event_id INT,
  paid_by VARCHAR(255) NOT NULL,
  created_date DATE NOT NULL,
  split_type ENUM('equal', 'custom', 'shares') NOT NULL,
  receipt_image TEXT,
  currency TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Create expense_participants table to store participant shares
CREATE TABLE IF NOT EXISTS expense_participants (
  id INT PRIMARY KEY AUTO_INCREMENT,
  expense_id INT NOT NULL,
  participant_id VARCHAR(255) NOT NULL,
  share_amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  he_participates BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES particiapnts(id) ON DELETE CASCADE

);

CREATE TABLE `participants` (
  id int(11) NOT NULL,
  event_id int(11) NOT NULL,
  name varchar(255) NOT NULL,
  custom_amount decimal(10,2) DEFAULT NULL,
  user_id int(11) DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE

)

CREATE TABLE events (
  id int(11) NOT NULL,
  name varchar(255) NOT NULL,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  currency varchar(10) DEFAULT NULL,
  split_type enum('equal','custom') DEFAULT 'equal',
  created_at timestamp NOT NULL DEFAULT current_timestamp(),
  created_by varchar(255) NOT NULL
  code varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `users` (
  id int(11) NOT NULL,
  username varchar(255) NOT NULL,
  password varchar(255) NOT NULL,
  email varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Add indexes for better query performance
CREATE INDEX idx_expenses_event ON expenses(event_id);
CREATE INDEX idx_expense_participants_expense ON expense_participants(expense_id);
CREATE INDEX idx_expense_participants_participant ON expense_participants(participant_id);