// Tables + seed rows shared by the scheduled-emails tests (#3930)
export const DDL = [
  `CREATE TABLE bookings_emailtemplates (id text primary key, teamId text not null, owner text not null, "order" integer not null, name text not null, subject text not null, body text not null, fromEmail text not null, triggerType text not null, recipientType text not null, isActive integer, daysOffset integer, locationId text, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`,
  `CREATE TABLE bookings_emaillogs (id text primary key, teamId text not null, owner text not null, "order" integer not null, bookingId text, templateId text, recipientEmail text not null, triggerType text not null, status text not null, sentAt text, error text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);`,
  `CREATE TABLE user (id text primary key, name text, email text, image text);`,
  `CREATE TABLE organization (id text primary key, name text not null, slug text, metadata text);`,
  `CREATE TABLE bookings_locations (id text primary key, teamId text not null, owner text, "order" integer, title text, color text, street text, zip text, city text, location text, content text, allowedMemberIds text, slots text, openDays text, slotSchedule text, blockedDates text, translations text, products text, createdAt integer, updatedAt integer, createdBy text, updatedBy text);`,
  `CREATE TABLE bookings_bookings (id text primary key, teamId text not null, owner text, "order" integer, location text, product text, date integer, slot text, "group" text, quantity integer, status text, createdAt integer, updatedAt integer, createdBy text, updatedBy text);`,
  `INSERT INTO user VALUES ('cust','Customer One','cust@example.com',null), ('cust2','Customer Two','cust2@example.com',null), ('noemail','Nobody',null,null);`,
  `INSERT INTO organization VALUES ('tA','Team A','a',null), ('tB','Team B','b','{"email":"b@team.be"}');`,
  `INSERT INTO bookings_locations (id, teamId, title, slots) VALUES ('l1','tA','Loc 1','[{"id":"am","label":"Morning"}]'), ('l2','tA','Loc 2',null), ('lb','tB','Loc B',null);`,
]
