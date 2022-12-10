create database if not exists testfk;
drop table if exists testfk.fkdifferentdb;

use test;
# drop tables in proper order to avoid foreign key constraint violations
drop table if exists shipment;
drop table if exists lineitem;
drop table if exists shoppingcart;
drop table if exists customerdiscount;
drop table if exists customer;
drop table if exists item;
drop table if exists discount;

# Customer has a oneToZeroOrOne relationship to ShoppingCart
# Customer has a manyToMany relationship to Discount via table customerdiscount
# Customer has a oneToZeroOrOne relationship to Shipment
create table customer (
  id int not null primary key,
  unikey int not null unique default 0,
  firstname varchar(32),
  lastname varchar(32),
  index keylastnamefirstname (lastname, firstname)
);

# ShoppingCart has a oneToOne relationship to Customer
# ShoppingCart has a oneToMany relationship to LineItem
create table shoppingcart (
  id int not null primary key,
  customerid int not null,
  created datetime not null default now(),
  constraint fkshoppingcartcustomerid foreign key (customerid) references customer(id)
);

# Item has a oneToMany relationship to LineItem
create table item(
  id int not null primary key,
  description varchar(99)
);

# LineItem has a manyToOne relationship to ShoppingCart
# LineItem has a manyToOne relationship to Item
create table lineitem (
  line int not null,
  shoppingcartid int not null,
  quantity int not null,
  itemid int not null,
  primary key(shoppingcartid, line),
  constraint fklineitemitemid foreign key (itemid) references item(id),
  constraint fklineitemshoppingcartid foreign key (shoppingcartid) references shoppingcart(id)
);

# Discount has a manyToMany relationship to Customer via table customerdiscount
create table discount(
  id int not null primary key,
  description varchar(32) not null,
  percent int not null,
  index keypercent(percent)
);

# customerdiscount is a simple join table
create table customerdiscount(
  customerid int not null,
  discountid int not null,
  constraint fkcustomerdiscountcustomerid foreign key (customerid) references customer(id),
  constraint fkcustomerdiscountdiscountid foreign key (discountid) references discount(id),
  primary key (customerid, discountid)
);

# Shipment has a many to one relationship to Customer
create table shipment(
  id int not null primary key,
  customerid int not null,
  constraint fkshipmentcustomerid foreign key (customerid) references customer(id),
  value decimal(30, 2)
);

insert into customer(id, unikey, firstname, lastname) values (100, 100, 'Craig', 'Walton');
insert into customer(id, unikey, firstname, lastname) values (101, 101, 'Sam', 'Burton');
insert into customer(id, unikey, firstname, lastname) values (102, 102, 'Wal', 'Greeton');
insert into customer(id, unikey, firstname, lastname) values (103, 103, 'Burn', 'Sexton');

insert into shipment(id, customerid, value) values (10000, 100, 120.99);
insert into shipment(id, customerid, value) values (10001, 100, 130);
insert into shipment(id, customerid, value) values (10100, 101, 1320.87);
insert into shipment(id, customerid, value) values (10102, 101, 144.44);
insert into shipment(id, customerid, value) values (10200, 102, 45.87);
insert into shipment(id, customerid, value) values (10201, 102, 67.44);
insert into shipment(id, customerid, value) values (10202, 102, 80.89);
insert into shipment(id, customerid, value) values (10203, 102, 1045.87);

insert into shoppingcart(id, customerid) values(1000, 100);
insert into shoppingcart(id, customerid) values(1002, 102);
insert into shoppingcart(id, customerid) values(1003, 103);

insert into item(id, description) values(10000, 'toothpaste');
insert into item(id, description) values(10001, 'razor blade 10 pack');
insert into item(id, description) values(10002, 'deodorant');
insert into item(id, description) values(10003, 'hatchet');
insert into item(id, description) values(10004, 'weed-b-gon');
insert into item(id, description) values(10005, 'cola 24 pack');
insert into item(id, description) values(10006, 'diet cola 24 pack');
insert into item(id, description) values(10007, 'diet root beer 12 pack');
insert into item(id, description) values(10008, 'whole wheat bread');
insert into item(id, description) values(10009, 'raisin bran');
insert into item(id, description) values(10010, 'milk gallon');
insert into item(id, description) values(10011, 'half and half');
insert into item(id, description) values(10012, 'tongue depressor');
insert into item(id, description) values(10013, 'smelling salt');
insert into item(id, description) values(10014, 'holy bible');

insert into lineitem(line, shoppingcartid, quantity, itemid) values(0, 1000, 1, 10000);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(1, 1000, 5, 10014);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(2, 1000, 2, 10011);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(0, 1002, 10, 10008);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(1, 1002, 4, 10010);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(2, 1002, 40, 10002);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(3, 1002, 100, 10011);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(4, 1002, 1, 10013);
insert into lineitem(line, shoppingcartid, quantity, itemid) values(5, 1002, 8, 10005);

insert into discount(id, description, percent) values(0, 'new customer', 10);
insert into discount(id, description, percent) values(1, 'good customer', 15);
insert into discount(id, description, percent) values(2, 'spring sale', 10);
insert into discount(id, description, percent) values(3, 'internet special', 20);
insert into discount(id, description, percent) values(4, 'closeout', 50);

insert into customerdiscount(customerid, discountid) values(100, 0);
insert into customerdiscount(customerid, discountid) values(101, 1);
insert into customerdiscount(customerid, discountid) values(101, 3);
insert into customerdiscount(customerid, discountid) values(101, 4);
insert into customerdiscount(customerid, discountid) values(102, 2);
insert into customerdiscount(customerid, discountid) values(103, 3);

create table testfk.fkdifferentdb (
  id int not null primary key,
  constraint fkdifferentdbcustomerid foreign key(id) references test.customer(id)
);

