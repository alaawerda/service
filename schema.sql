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
  created_at TIMESTAMP DEFAULT current_timestamp(),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Create expense_participants table to store participant shares
CREATE TABLE IF NOT EXISTS expense_participants (
  id INT PRIMARY KEY AUTO_INCREMENT,
  expense_id INT NOT NULL,
  participant_id VARCHAR(255) NOT NULL,
  share_amount DECIMAL(10, 2) NOT NULL,
  share_count INT ,
  created_at TIMESTAMP DEFAULT current_timestamp(),
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
  password varchar(255) DEFAULT NULL,
  email varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT current_timestamp(),
  google_id varchar(255) DEFAULT NULL,
  google_token varchar(255) DEFAULT NULL,
  profile_picture varchar(255) DEFAULT NULL,
  auth_provider ENUM('local', 'google') DEFAULT 'local'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Add indexes for better query performance
CREATE INDEX idx_expenses_event ON expenses(event_id);
CREATE INDEX idx_expense_participants_expense ON expense_participants(expense_id);
CREATE INDEX idx_expense_participants_participant ON expense_participants(participant_id);

-- Create reimbursements table
CREATE TABLE IF NOT EXISTS reimbursements (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  debtor_id INT NOT NULL,
  creditor_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  date TIMESTAMP DEFAULT current_timestamp(),
  status ENUM('pending', 'completed', 'disputed','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT current_timestamp(),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (debtor_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (creditor_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- Add indexes for reimbursements
CREATE INDEX idx_reimbursements_event ON reimbursements(event_id);
CREATE INDEX idx_reimbursements_debtor ON reimbursements(debtor_id);
CREATE INDEX idx_reimbursements_creditor ON reimbursements(creditor_id);
CREATE INDEX idx_reimbursements_status ON reimbursements(status);

-- Create banking_info table to store user banking information
CREATE TABLE IF NOT EXISTS banking_info (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  type ENUM('rib', 'iban', 'paypal', 'wise', 'revolut', 'other') NOT NULL,
  account_details TEXT NOT NULL,
  other_name VARCHAR(255),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT current_timestamp(),
  updated_at TIMESTAMP DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add indexes for better query performance
CREATE INDEX idx_banking_info_user ON banking_info(user_id);