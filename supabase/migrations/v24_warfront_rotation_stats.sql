-- v24_warfront_rotation_stats.sql
-- Warfront: update unit stats from reference, add 12-unit active pool rotation,
-- update enemy army to use rotation, update difficulty multipliers.

-- ── Updated unit data functions ──────────────────────────────────────────────

create or replace function public._warfront_units()
returns jsonb language sql immutable as $$
select jsonb_build_array(
  jsonb_build_object('id','peasant','name','Peasant','icon','🧑','cost',1,'hp',56,'dmg',3,'spd',52,'atk_rate',1.4,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',1,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','footman','name','Footman','icon','🛡','cost',1,'hp',63,'dmg',6,'spd',43,'atk_rate',1.2,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',true,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','bombgoblin','name','Bomb Goblin','icon','💥','cost',1,'hp',43,'dmg',36,'spd',100,'atk_rate',999,'aoe',54,'lane','ground','melee',true,'ranged',false,'rusher',true,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',true,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',true,'collection','fantasy'),
  jsonb_build_object('id','archer','name','Archer','icon','🏹','cost',2,'hp',29,'dmg',8,'spd',41,'atk_rate',0.9,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',true,'engageR',151,'baseEngR',151,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',2,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',true,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','assassin','name','Assassin','icon','🗡','cost',2,'hp',53,'dmg',24,'spd',68,'atk_rate',1.4,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',true,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','shaman','name','Shaman','icon','✦','cost',2,'hp',44,'dmg',0,'spd',45,'atk_rate',999,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',200,'baseEngR',200,'aoeShield',0,'regenPerSec',0,'healRange',120,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',true,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','lumberjack','name','Lumberjack','icon','🪓','cost',2,'hp',68,'dmg',11,'spd',65,'atk_rate',0.6,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'lumberjackAxe',true,'collection','fantasy'),
  jsonb_build_object('id','angel','name','Angel','icon','🪽','cost',2,'hp',65,'dmg',0,'spd',60,'atk_rate',999,'aoe',0,'lane','air','melee',false,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',200,'baseEngR',200,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'isAngel',true,'angelCooldown',2,'collection','fantasy'),
  jsonb_build_object('id','brute','name','Brute','icon','⚔','cost',3,'hp',110,'dmg',18,'spd',60,'atk_rate',0.9,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',true,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','cavalry','name','Cavalry','icon','🏇','cost',3,'hp',72,'dmg',29,'spd',63,'atk_rate',1.8,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',true,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',true,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','harpy','name','Fairy','icon','🧚','cost',3,'hp',53,'dmg',9,'spd',89,'atk_rate',1.3,'aoe',0,'lane','air','melee',true,'ranged',false,'rusher',true,'can_air',true,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',0.5,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','troll','name','Troll','icon','👹','cost',3,'hp',154,'dmg',13,'spd',48,'atk_rate',1.3,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',3,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','voidwalker','name','Voidwalker','icon','👾','cost',3,'hp',97,'dmg',20,'spd',62,'atk_rate',1.1,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',5,'voidDur',1.5,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',true,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','frostwitch','name','Frost Witch','icon','❄','cost',4,'hp',104,'dmg',18,'spd',44,'atk_rate',1.6,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',185,'baseEngR',185,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',2.0,'frostSlowPct',0.7,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','mage','name','Mage','icon','🔮','cost',4,'hp',48,'dmg',22,'spd',42,'atk_rate',1.6,'aoe',50,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',true,'engageR',150,'baseEngR',150,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','mirrormage','name','Mirror Mage','icon','🪞','cost',4,'hp',98,'dmg',16,'spd',40,'atk_rate',1.5,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0.4,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'mirrorAll',true,'collection','fantasy'),
  jsonb_build_object('id','necromancer','name','Necromancer','icon','💀','cost',4,'hp',104,'dmg',21,'spd',35,'atk_rate',1.9,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',true,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','genie','name','Genie','icon','🧞','cost',4,'hp',174,'dmg',17,'spd',45,'atk_rate',1.3,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'wishCooldown',12,'collection','fantasy'),
  jsonb_build_object('id','timewizard','name','Time Wizard','icon','⏳','cost',3,'hp',118,'dmg',16,'spd',36,'atk_rate',2.1,'aoe',0,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',80,'baseEngR',80,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'spellCooldown',6,'collection','fantasy'),
  jsonb_build_object('id','phoenix','name','Phoenix','icon','🔥','cost',5,'hp',66,'dmg',18,'spd',66,'atk_rate',1.4,'aoe',40,'lane','air','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',140,'baseEngR',140,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',true,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','warlord','name','Warlord','icon','👑','cost',5,'hp',152,'dmg',20,'spd',38,'atk_rate',1.1,'aoe',0,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',true,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','siege','name','Siege Engine','icon','💣','cost',5,'hp',55,'dmg',40,'spd',27,'atk_rate',2.1,'aoe',62,'lane','ground','melee',false,'ranged',true,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',160,'baseEngR',160,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','stormdrake','name','Storm Drake','icon','🐲','cost',5,'hp',85,'dmg',19,'spd',70,'atk_rate',1.8,'aoe',0,'lane','air','melee',false,'ranged',true,'rusher',false,'can_air',true,'prioritise_air',false,'engageR',160,'baseEngR',160,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',3,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'collection','fantasy'),
  jsonb_build_object('id','golem','name','Golem','icon','🗿','cost',6,'hp',351,'dmg',32,'spd',24,'atk_rate',2.2,'aoe',42,'lane','ground','melee',true,'ranged',false,'rusher',false,'can_air',false,'prioritise_air',false,'engageR',36,'baseEngR',36,'aoeShield',0,'regenPerSec',0,'healRange',0,'reflectPct',0,'slowDur',0,'airMult',1,'aoeResist',1,'chain',0,'voidCycle',0,'voidDur',0,'isSelf',false,'isPx',false,'isAss',false,'isShaman',false,'isNecro',false,'isWarlord',false,'isFootman',false,'isArcher',false,'isBrute',false,'isCav',false,'isVoid',false,'isGoblin',false,'golemDoubleStrike',true,'collection','fantasy')
)::jsonb;
$$;

create or replace function public._warfront_animal_units()
returns jsonb language sql immutable as $$
select jsonb_build_array(
  jsonb_build_object('id','rat','name','Rat','icon','🐀','cost',1,'hp',22,'dmg',7,'spd',97,'atk_rate',0.3,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','wolfpack','name','Wolf Pack','icon','🐺','cost',1,'hp',16,'dmg',5,'spd',65,'atk_rate',0.9,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','squirrel','name','Squirrel','icon','🐿','cost',1,'hp',28,'dmg',7,'spd',90,'atk_rate',0.8,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','tortoise','name','Tortoise','icon','🐢','cost',2,'hp',105,'dmg',6,'spd',22,'atk_rate',1.9,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',-35,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','eagle','name','Eagle','icon','🦅','cost',2,'hp',33,'dmg',13,'spd',100,'atk_rate',1.8,'lane','air','ranged',false,'healer',false,'aoe',0,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','bee','name','Bee','icon','🐝','cost',2,'hp',29,'dmg',6,'spd',95,'atk_rate',1.2,'lane','air','ranged',true,'healer',false,'aoe',0,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','bat','name','Bat','icon','🦇','cost',2,'hp',39,'dmg',9,'spd',100,'atk_rate',0.9,'lane','air','ranged',false,'healer',false,'aoe',0,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','kangaroo','name','Kangaroo','icon','🦘','cost',2,'hp',58,'dmg',21,'spd',75,'atk_rate',1.5,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','viper','name','Viper','icon','🐍','cost',3,'hp',62,'dmg',14,'spd',60,'atk_rate',0.8,'lane','ground','ranged',true,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','bear','name','Bear','icon','🐻','cost',3,'hp',140,'dmg',18,'spd',50,'atk_rate',1.2,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','chameleon','name','Chameleon','icon','🦎','cost',3,'hp',75,'dmg',22,'spd',65,'atk_rate',1.3,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','jellyfish','name','Jellyfish','icon','🪼','cost',3,'hp',44,'dmg',14,'spd',35,'atk_rate',2.0,'lane','air','ranged',true,'healer',false,'aoe',55,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','mantisshrimp','name','Mantis Shrimp','icon','🦐','cost',3,'hp',69,'dmg',24,'spd',58,'atk_rate',0.7,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','scorpion','name','Scorpion','icon','🦂','cost',3,'hp',81,'dmg',20,'spd',71,'atk_rate',0.7,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',1.5,'assassin',false,'collection','animals'),
  jsonb_build_object('id','skunk','name','Skunk','icon','🦨','cost',3,'hp',94,'dmg',11,'spd',48,'atk_rate',1.8,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','zebra','name','Zebra','icon','🦓','cost',3,'hp',133,'dmg',14,'spd',80,'atk_rate',1.4,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','rhino','name','Rhino','icon','🦏','cost',4,'hp',106,'dmg',24,'spd',100,'atk_rate',2.5,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','crocodile','name','Crocodile','icon','🐊','cost',4,'hp',103,'dmg',27,'spd',45,'atk_rate',0.8,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','giraffe','name','Giraffe','icon','🦒','cost',4,'hp',106,'dmg',20,'spd',46,'atk_rate',1.3,'lane','ground','ranged',true,'healer',false,'aoe',0,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','tiger','name','Tiger','icon','🐅','cost',4,'hp',102,'dmg',24,'spd',72,'atk_rate',0.8,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','gorilla','name','Gorilla','icon','🦍','cost',4,'hp',161,'dmg',28,'spd',65,'atk_rate',1.3,'lane','ground','ranged',false,'healer',false,'aoe',0,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','shark','name','Shark','icon','🦈','cost',5,'hp',108,'dmg',31,'spd',68,'atk_rate',1.2,'lane','air','ranged',false,'healer',false,'aoe',0,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','elephant','name','Elephant','icon','🐘','cost',5,'hp',254,'dmg',24,'spd',37,'atk_rate',1.8,'lane','ground','ranged',false,'healer',false,'aoe',50,'can_air',false,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals'),
  jsonb_build_object('id','whale','name','Whale','icon','🐋','cost',6,'hp',314,'dmg',20,'spd',25,'atk_rate',2.1,'lane','air','ranged',true,'healer',false,'aoe',50,'can_air',true,'trample',false,'phoenix',false,'regen',0,'reflect',0,'slow',0,'assassin',false,'collection','animals')
)::jsonb;
$$;

-- ── Active pool rotation (12 units per collection, changes each warfront rotation window) ─────

create or replace function public._warfront_active_pool(
  p_collection text,
  p_n int default 12
) returns text[] language plpgsql stable as $$
declare
  v_epoch timestamptz := '2026-01-01 00:00:00+00';
  v_game_pool_n int := 12;  -- total games in game_pool()
  v_wf_idx int := 11;       -- 0-based index of warfront in game_pool()
  v_h_index bigint := floor(extract(epoch from (now() - v_epoch)) / 3600)::bigint;
  -- generation = which active window warfront is in; changes every 12h when warfront enters rotation
  v_generation bigint := floor((v_h_index - (v_wf_idx + 5))::numeric / v_game_pool_n)::bigint;
  -- XOR with collection-specific constant for independent shuffles
  v_seed bigint := v_generation # (case when p_collection = 'animals' then 1515870810 else 2779096485 end);
  v_ids text[];
  v_n int; i int; j int; tmp text;
  v_s bigint;
begin
  v_ids := case when p_collection = 'animals'
    then array['rat','wolfpack','squirrel','tortoise','eagle','bee','bat','kangaroo',
               'viper','bear','chameleon','jellyfish','mantisshrimp','scorpion','skunk',
               'zebra','rhino','crocodile','giraffe','tiger','gorilla','shark','elephant','whale']
    else array['peasant','footman','bombgoblin','archer','assassin','shaman','lumberjack',
               'angel','brute','cavalry','harpy','troll','voidwalker','frostwitch','mage',
               'mirrormage','necromancer','genie','phoenix','warlord','siege','stormdrake',
               'timewizard','golem']
  end;
  v_n := array_length(v_ids, 1);
  -- Fisher-Yates shuffle with seeded LCG
  v_s := v_seed & 4294967295;
  for i in reverse v_n..2 loop
    v_s := ((v_s * 1664525) + 1013904223) & 4294967295;
    j := 1 + (v_s % i)::int;
    tmp := v_ids[i]; v_ids[i] := v_ids[j]; v_ids[j] := tmp;
  end loop;
  return v_ids[1:least(p_n, v_n)];
end;
$$;

grant execute on function public._warfront_active_pool(text, int) to authenticated;

-- ── Updated enemy army generation using active pool ───────────────────────────

drop function if exists public._warfront_enemy_army(integer, text);

create or replace function public._warfront_enemy_army(p_budget int, p_collection text default 'fantasy')
returns jsonb language plpgsql stable as $$
declare
  v_units jsonb := case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end;
  v_ids text[] := public._warfront_active_pool(p_collection, 12);
  v_army text[] := '{}';
  v_budget int := p_budget;
  v_cost int;
  v_id text;
  v_u jsonb;
  v_has_ranged boolean := false;
begin
  while v_budget > 0 loop
    v_id := v_ids[1+floor(random()*array_length(v_ids,1))::int];
    select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
    v_cost := coalesce((v_u->>'cost')::int, 99);
    if v_cost > v_budget then
      v_id := case when p_collection = 'animals'
        then (case when random()<0.5 then 'rat' else 'wolfpack' end)
        else (case when random()<0.5 then 'footman' else 'peasant' end)
      end;
      -- ensure fallback is in active pool, else just exit
      if not (v_id = any(v_ids)) then exit; end if;
      select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
      v_cost := coalesce((v_u->>'cost')::int, 99);
      if v_cost > v_budget then exit; end if;
    end if;
    v_army := array_append(v_army, v_id);
    v_budget := v_budget - v_cost;
    if (v_u->>'ranged')::boolean or (v_u->>'can_air')::boolean then v_has_ranged := true; end if;
  end loop;
  -- ensure at least one ranged/air unit if needed
  if not v_has_ranged and array_length(v_army,1)>0 then
    select u->>'id' into v_id
      from jsonb_array_elements(v_units) u
      where u->>'id' = any(v_ids)
        and ((u->>'ranged')::boolean or (u->>'can_air')::boolean)
      limit 1;
    if v_id is not null then v_army[1] := v_id; end if;
  end if;
  return to_jsonb(v_army);
end;
$$;

-- ── Updated play_warfront with active pool validation ─────────────────────────

drop function if exists public.play_warfront(integer, text[], text, integer);

create or replace function public.play_warfront(
  p_bet integer,
  p_picks text[],
  p_collection text default 'fantasy',
  p_draft_budget integer default 10
) returns table (
  new_balance integer,
  player_base_hp integer,
  enemy_base_hp integer,
  multiplier numeric,
  payout integer,
  won boolean,
  enemy_army jsonb,
  enemy_difficulty text,
  enemy_budget integer
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_total_cost int := 0;
  v_u jsonb;
  v_id text;
  v_e_budget int;
  v_e_army jsonb;
  v_p_score numeric;
  v_e_score numeric;
  v_roll numeric;
  v_win_prob numeric;
  v_pb int := 100;
  v_eb int := 100;
  v_mult numeric := 0;
  v_payout int := 0;
  v_won boolean := false;
  v_diff_name text;
  v_balance int;
  v_margin numeric;
  v_active_pool text[];
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_bet < 10 then raise exception 'Bet must be at least 10'; end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;
  v_active_pool := public._warfront_active_pool(p_collection, 12);
  -- validate picks cost and active pool membership
  for v_i in 1..array_length(p_picks,1) loop
    v_id := p_picks[v_i];
    select u from jsonb_array_elements(
      case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end
    ) u where u->>'id' = v_id into v_u;
    if v_u is null then raise exception 'Invalid unit: %', v_id; end if;
    if coalesce(v_u->>'collection','fantasy') <> p_collection then
      raise exception 'Unit % does not belong to collection %', v_id, p_collection;
    end if;
    if not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_total_cost := v_total_cost + (v_u->>'cost')::int;
  end loop;
  if v_total_cost > p_draft_budget then
    raise exception 'Unit cost % exceeds draft budget %', v_total_cost, p_draft_budget;
  end if;
  -- deduct bet
  perform public._apply_credit_delta(v_user_id, -p_bet, 'warfront',
    jsonb_build_object('phase','wager','picks',to_jsonb(p_picks),'collection',p_collection,'draft_budget',p_draft_budget));
  -- generate enemy budget
  v_e_budget := p_draft_budget + case
    when random() < 0.15 then 1
    when random() < 0.30 then 2
    when random() < 0.55 then 3
    when random() < 0.80 then 4
    else 5
  end;
  v_e_army := public._warfront_enemy_army(v_e_budget, p_collection);
  -- difficulty name
  v_diff_name := case
    when v_e_budget <= p_draft_budget + 1 then 'Easy'
    when v_e_budget =  p_draft_budget + 2 then 'Normal'
    when v_e_budget =  p_draft_budget + 3 then 'Hard'
    when v_e_budget =  p_draft_budget + 4 then 'Brutal'
    when v_e_budget =  p_draft_budget + 5 then 'Legendary'
    else 'Impossible'
  end;
  -- compute scores
  v_p_score := public._warfront_score(to_jsonb(p_picks), p_collection, true);
  v_e_score := public._warfront_score(v_e_army, p_collection, false);
  -- win probability
  v_win_prob := 0.45;
  if v_p_score + v_e_score > 0 then
    v_win_prob := 0.45 + ((v_p_score - v_e_score) / (v_p_score + v_e_score + 100)) * 0.35;
  end if;
  v_win_prob := greatest(0.15, least(0.85, v_win_prob));
  -- roll
  v_roll := random();
  if v_roll < v_win_prob then
    v_won := true;
    v_margin := (v_win_prob - v_roll) / greatest(v_win_prob, 0.001);
    v_pb := 10 + floor(v_margin * 90)::int;
    if v_pb > 100 then v_pb := 100; end if;
    if v_margin > 0.6 then v_eb := 0;
    else v_eb := 10 + floor(random() * 40)::int; end if;
  else
    v_won := false;
    v_pb := 0;
    v_eb := 10 + floor((1 - (v_roll - v_win_prob) / greatest(1 - v_win_prob, 0.001)) * 90)::int;
  end if;
  -- multiplier (matches DIFF_TABLE)
  if v_won then
    v_mult := case v_diff_name
      when 'Easy'       then 1.2
      when 'Normal'     then 1.5
      when 'Hard'       then 2.0
      when 'Brutal'     then 3.0
      when 'Legendary'  then 5.0
      when 'Impossible' then 10.0
      else 1.2
    end;
    -- bonus for perfect win
    if v_eb = 0 then v_mult := v_mult * 1.5; end if;
    v_payout := floor(p_bet * v_mult)::int;
    if v_payout > 0 then
      perform public._apply_credit_delta(v_user_id, v_payout, 'warfront',
        jsonb_build_object('phase','reward','picks',to_jsonb(p_picks),'collection',p_collection,
          'player_base_hp',v_pb,'enemy_base_hp',v_eb,'multiplier',v_mult,'enemy_difficulty',v_diff_name));
    end if;
  end if;
  -- record
  insert into public.warfront_games (user_id,bet,player_picks,formation,collection,enemy_difficulty,enemy_budget,enemy_army,player_base_hp,enemy_base_hp,multiplier,payout,battle_log)
  values (v_user_id,p_bet,to_jsonb(p_picks),null,p_collection,v_diff_name,v_e_budget,v_e_army,v_pb,v_eb,v_mult,v_payout,'[]'::jsonb);
  select credits into v_balance from public.profiles where id = v_user_id;
  return query select v_balance, v_pb, v_eb, v_mult, v_payout, v_won, v_e_army, v_diff_name, v_e_budget;
end;
$$;

grant execute on function public.play_warfront(integer, text[], text, integer) to authenticated;

-- ── Fix _warfront_score: use ::numeric for all float-capable fields ───────────

drop function if exists public._warfront_score(jsonb, text, boolean);

create or replace function public._warfront_score(p_army jsonb, p_collection text, p_is_player boolean)
returns numeric language plpgsql as $$
declare
  v_units jsonb := case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end;
  v_score numeric := 0;
  v_id text;
  v_u jsonb;
  v_hp numeric; v_dmg numeric; v_spd numeric;
  v_rate numeric; v_val numeric;
  v_has_warlord boolean := false;
  v_has_shaman int := 0;
  v_has_necro boolean := false;
  v_arr text[];
begin
  select array_agg(x) into v_arr from jsonb_array_elements_text(p_army) x;
  for v_i in 1..coalesce(array_length(v_arr,1),0) loop
    v_id := v_arr[v_i];
    select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
    if v_u is null then continue; end if;
    v_hp  := coalesce((v_u->>'hp')::numeric, 0);
    v_dmg := coalesce((v_u->>'dmg')::numeric, 0);
    v_spd := coalesce((v_u->>'spd')::numeric, 50);
    v_rate := greatest(coalesce((v_u->>'atk_rate')::numeric, 1), 0.5);
    v_val := (v_hp * v_dmg) / v_rate;
    v_val := v_val * least(v_spd / 100.0, 1.5);
    if coalesce((v_u->>'healer')::boolean, false) then v_val := v_val * 1.4; end if;
    if coalesce((v_u->>'aoe')::numeric, 0) > 0 then v_val := v_val * 1.25; end if;
    if coalesce((v_u->>'trample')::boolean, false) then v_val := v_val * 1.15; end if;
    if coalesce((v_u->>'phoenix')::boolean, false) then v_val := v_val * 1.2; end if;
    -- 'regen' (animals) or 'regenPerSec' (fantasy) — both work
    if coalesce((v_u->>'regen')::numeric, (v_u->>'regenPerSec')::numeric, 0) > 0 then v_val := v_val * 1.1; end if;
    -- 'reflect' (animals) or 'reflectPct' (fantasy)
    if coalesce((v_u->>'reflect')::numeric, (v_u->>'reflectPct')::numeric, 0) > 0 then v_val := v_val * 1.1; end if;
    -- 'slow' (animals) or 'slowDur' (fantasy)
    if coalesce((v_u->>'slow')::numeric, (v_u->>'slowDur')::numeric, 0) > 0 then v_val := v_val * 1.05; end if;
    if coalesce((v_u->>'assassin')::boolean, false) then v_val := v_val * 1.2; end if;
    if coalesce((v_u->>'can_air')::boolean, false) and not coalesce((v_u->>'ranged')::boolean, false) then
      v_val := v_val * 1.15;
    end if;
    if v_id = 'warlord' then v_has_warlord := true; end if;
    if v_id = 'shaman' then v_has_shaman := v_has_shaman + 1; end if;
    if v_id = 'necromancer' then v_has_necro := true; end if;
    v_score := v_score + v_val;
  end loop;
  if v_has_warlord then v_score := v_score * 1.15; end if;
  if v_has_shaman > 0 then v_score := v_score * (1 + v_has_shaman * 0.08); end if;
  if v_has_necro then v_score := v_score * 1.05; end if;
  return v_score;
end;
$$;

-- ── Add resolved column to warfront_games ────────────────────────────────────

alter table public.warfront_games
  add column if not exists resolved boolean not null default false;

-- ── Updated enemy army generation with player-picks bias ─────────────────────

drop function if exists public._warfront_enemy_army(integer, text);
drop function if exists public._warfront_enemy_army(integer, text, text[]);

create or replace function public._warfront_enemy_army(
  p_budget int,
  p_collection text default 'fantasy',
  p_player_picks text[] default '{}'
) returns jsonb language plpgsql stable as $$
declare
  v_units jsonb := case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end;
  v_ids text[] := public._warfront_active_pool(p_collection, 12);
  v_army text[] := '{}';
  v_budget int := p_budget;
  v_cost int;
  v_id text;
  v_u jsonb;
  v_has_ranged boolean := false;
  v_tries int := 0;
begin
  while v_budget > 0 and v_tries < 300 loop
    v_tries := v_tries + 1;
    v_id := v_ids[1+floor(random()*array_length(v_ids,1))::int];
    -- 50% skip bias: reduce chance of picking units the player already has
    if v_id = any(p_player_picks) and random() < 0.5 then continue; end if;
    select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
    v_cost := coalesce((v_u->>'cost')::int, 99);
    if v_cost > v_budget then
      v_id := case when p_collection = 'animals'
        then (case when random()<0.5 then 'rat' else 'wolfpack' end)
        else (case when random()<0.5 then 'footman' else 'peasant' end)
      end;
      if not (v_id = any(v_ids)) then exit; end if;
      select u from jsonb_array_elements(v_units) u where u->>'id' = v_id into v_u;
      v_cost := coalesce((v_u->>'cost')::int, 99);
      if v_cost > v_budget then exit; end if;
    end if;
    v_army := array_append(v_army, v_id);
    v_budget := v_budget - v_cost;
    if coalesce((v_u->>'ranged')::boolean, false) or coalesce((v_u->>'can_air')::boolean, false) then
      v_has_ranged := true;
    end if;
  end loop;
  -- ensure at least one ranged/air unit if needed
  if not v_has_ranged and array_length(v_army,1) > 0 then
    select u->>'id' into v_id
      from jsonb_array_elements(v_units) u
      where u->>'id' = any(v_ids)
        and (coalesce((u->>'ranged')::boolean, false) or coalesce((u->>'can_air')::boolean, false))
      limit 1;
    if v_id is not null then v_army[1] := v_id; end if;
  end if;
  return to_jsonb(v_army);
end;
$$;

-- ── Two-phase play_warfront: deduct bet + generate enemy, no payout yet ──────

drop function if exists public.play_warfront(integer, text[], text, integer);

create or replace function public.play_warfront(
  p_bet integer,
  p_picks text[],
  p_collection text default 'fantasy',
  p_draft_budget integer default 10
) returns table (
  game_id uuid,
  enemy_army jsonb,
  enemy_difficulty text,
  enemy_budget integer
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_total_cost int := 0;
  v_u jsonb;
  v_id text;
  v_e_budget int;
  v_e_army jsonb;
  v_diff_name text;
  v_game_id uuid;
  v_active_pool text[];
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_bet < 10 then raise exception 'Bet must be at least 10'; end if;
  if array_length(p_picks,1) is null or array_length(p_picks,1) > 6 then
    raise exception 'Pick between 1 and 6 units';
  end if;
  if p_collection not in ('fantasy','animals') then
    raise exception 'Invalid collection: %', p_collection;
  end if;
  v_active_pool := public._warfront_active_pool(p_collection, 12);
  for v_i in 1..array_length(p_picks,1) loop
    v_id := p_picks[v_i];
    select u from jsonb_array_elements(
      case when p_collection = 'animals' then public._warfront_animal_units() else public._warfront_units() end
    ) u where u->>'id' = v_id into v_u;
    if v_u is null then raise exception 'Invalid unit: %', v_id; end if;
    if coalesce(v_u->>'collection','fantasy') <> p_collection then
      raise exception 'Unit % does not belong to collection %', v_id, p_collection;
    end if;
    if not (v_id = any(v_active_pool)) then
      raise exception 'Unit % is not in the current rotation', v_id;
    end if;
    v_total_cost := v_total_cost + (v_u->>'cost')::int;
  end loop;
  if v_total_cost > p_draft_budget then
    raise exception 'Unit cost % exceeds draft budget %', v_total_cost, p_draft_budget;
  end if;
  perform public._apply_credit_delta(v_user_id, -p_bet, 'warfront',
    jsonb_build_object('phase','wager','picks',to_jsonb(p_picks),'collection',p_collection,'draft_budget',p_draft_budget));
  v_e_budget := p_draft_budget + case
    when random() < 0.15 then 1
    when random() < 0.30 then 2
    when random() < 0.55 then 3
    when random() < 0.80 then 4
    else 5
  end;
  v_e_army := public._warfront_enemy_army(v_e_budget, p_collection, p_picks);
  v_diff_name := case
    when v_e_budget <= p_draft_budget + 1 then 'Easy'
    when v_e_budget =  p_draft_budget + 2 then 'Normal'
    when v_e_budget =  p_draft_budget + 3 then 'Hard'
    when v_e_budget =  p_draft_budget + 4 then 'Brutal'
    when v_e_budget =  p_draft_budget + 5 then 'Legendary'
    else 'Impossible'
  end;
  insert into public.warfront_games
    (user_id, bet, player_picks, formation, collection, enemy_difficulty, enemy_budget, enemy_army,
     player_base_hp, enemy_base_hp, multiplier, payout, battle_log, resolved)
  values
    (v_user_id, p_bet, to_jsonb(p_picks), null, p_collection, v_diff_name, v_e_budget, v_e_army,
     0, 0, 0, 0, '[]'::jsonb, false)
  returning id into v_game_id;
  return query select v_game_id, v_e_army, v_diff_name, v_e_budget;
end;
$$;

grant execute on function public.play_warfront(integer, text[], text, integer) to authenticated;

-- ── resolve_warfront: apply payout based on animation HP outcome ──────────────

create or replace function public.resolve_warfront(
  p_game_id uuid,
  p_player_base_hp integer,
  p_enemy_base_hp integer
) returns table (
  new_balance integer,
  multiplier numeric,
  payout integer,
  won boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.warfront_games%rowtype;
  v_won boolean;
  v_mult numeric := 0;
  v_payout int := 0;
  v_balance int;
begin
  select * into v_game from public.warfront_games
  where id = p_game_id and user_id = v_user_id;
  if not found then raise exception 'Game not found'; end if;
  if v_game.resolved then raise exception 'Game already resolved'; end if;
  -- win is determined server-side from reported HP values (enemy dead, player alive)
  v_won := (p_enemy_base_hp = 0 AND p_player_base_hp > 0);
  if v_won then
    v_mult := case v_game.enemy_difficulty
      when 'Easy'       then 1.2
      when 'Normal'     then 1.5
      when 'Hard'       then 2.0
      when 'Brutal'     then 3.0
      when 'Legendary'  then 5.0
      when 'Impossible' then 10.0
      else 1.2
    end;
    if p_enemy_base_hp = 0 and p_player_base_hp >= 100 then v_mult := v_mult * 1.5; end if;
    v_payout := floor(v_game.bet * v_mult)::int;
    if v_payout > 0 then
      perform public._apply_credit_delta(v_user_id, v_payout, 'warfront',
        jsonb_build_object('phase','reward','game_id',p_game_id,
          'player_base_hp',p_player_base_hp,'enemy_base_hp',p_enemy_base_hp,
          'multiplier',v_mult,'enemy_difficulty',v_game.enemy_difficulty));
    end if;
  end if;
  update public.warfront_games
  set resolved = true,
      player_base_hp = p_player_base_hp,
      enemy_base_hp = p_enemy_base_hp,
      multiplier = v_mult,
      payout = v_payout
  where id = p_game_id;
  select credits into v_balance from public.profiles where id = v_user_id;
  return query select v_balance, v_mult, v_payout, v_won;
end;
$$;

grant execute on function public.resolve_warfront(uuid, integer, integer) to authenticated;
