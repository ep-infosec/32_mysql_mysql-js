use test;
DROP TABLE if EXISTS towns;

CREATE TABLE `towns` (
  `town` varchar(50) NOT NULL,
  `county` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`town`)
);

