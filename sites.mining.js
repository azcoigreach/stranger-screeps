require("populations");

let _CPU = require("util.cpu");
let Hive = require("hive");

module.exports = {

	Run: function(rmColony, rmHarvest) {
		_CPU.Start(rmColony, "Mining-init");

		// Local mining: ensure the room has a spawn or tower... rebuilding? Sacked? Unclaimed?
		if (rmColony == rmHarvest) {
			if (_.get(Game, ["rooms", rmColony, "controller", "my"]) != true) {
				delete Memory.sites.mining.rmHarvest;
				return;
			}
			
			if (_.filter(_.get(Game, ["spawns"]), s => { return s.room.name == rmColony; }).length < 1
					&& _.get(Memory, ["rooms", rmColony, "focus_defense"]) != true)
				return;

			if (_.get(Memory, ["rooms", rmColony, "focus_defense"]) == true
					&& _.get(Game, ["rooms", rmColony, "controller", "level"]) < 3)
				return;
		}
			
		// Remote mining: colony destroyed? Stop mining :(
		if (Game.rooms[rmColony] == null) {
			delete Memory.sites.mining.rmHarvest;
			return;
		}
		
		listSpawnRooms = _.get(Memory, ["sites", "mining", rmHarvest, "spawn_assist", "rooms"]);
		listRoute = _.get(Memory, ["sites", "mining", rmHarvest, "list_route"]);
		listPopulation = _.get(Memory, ["sites", "mining", rmHarvest, "custom_population"]);
		hasKeepers = _.get(Memory, ["sites", "mining", rmHarvest, "has_keepers"], false);

		if (rmColony == rmHarvest 
				&& _.filter(_.get(Game, ["spawns"]), s => { return s.room.name == rmColony; }).length < 1) {
			listSpawnRooms = _.get(Memory, ["rooms", rmColony, "spawn_assist", "rooms"]);
			listRoute = _.get(Memory, ["rooms", rmColony, "spawn_assist", "list_route"]);
		}

		_CPU.End(rmColony, "Mining-init");

		_CPU.Start(rmColony, `Mining-${rmHarvest}-listCreeps`);
		let listCreeps = _.filter(Game.creeps, c => c.memory.room == rmHarvest && c.memory.colony == rmColony);
		_CPU.End(rmColony, `Mining-${rmHarvest}-listCreeps`);

		_CPU.Start(rmColony, `Mining-${rmHarvest}-surveyRoom`);
		if (Game.time % 3 == 0 || Game.time % 100 == 0)
			this.surveyRoom(rmColony, rmHarvest);
		_CPU.End(rmColony, `Mining-${rmHarvest}-surveyRoom`);

		if (isPulse_Spawn()) {
			_CPU.Start(rmColony, `Mining-${rmHarvest}-runPopulation`);
			this.runPopulation(rmColony, rmHarvest, listCreeps, listSpawnRooms, hasKeepers, listPopulation);
			_CPU.End(rmColony, `Mining-${rmHarvest}-runPopulation`);
		}

		_CPU.Start(rmColony, `Mining-${rmHarvest}-runCreeps`);
		this.runCreeps(rmColony, rmHarvest, listCreeps, hasKeepers, listRoute);
		_CPU.End(rmColony, `Mining-${rmHarvest}-runCreeps`);

		_CPU.Start(rmColony, `Mining-${rmHarvest}-buildContainers`);
		this.buildContainers(rmColony, rmHarvest);
		_CPU.End(rmColony, `Mining-${rmHarvest}-buildContainers`);
	},

	surveyRoom: function(rmColony, rmHarvest) {
		let visible = _.keys(Game.rooms).includes(rmHarvest);
		_.set(Memory, ["sites", "mining", rmHarvest, "visible"], visible);
		_.set(Memory, ["sites", "mining", rmHarvest, "has_minerals"],
			visible ? Game.rooms[rmHarvest].find(FIND_MINERALS, {filter: (m) => { return m.mineralAmount > 0; }}).length > 0 : false);

		let hostiles = visible 
			? _.filter(Game.rooms[rmHarvest].find(FIND_HOSTILE_CREEPS), 
				c => { return c.isHostile() && c.owner.username != "Source Keeper"; })
			: new Array();
		
		let is_safe = !visible || rmColony == rmHarvest || hostiles.length == 0;
		_.set(Memory, ["rooms", rmHarvest, "is_safe"], is_safe);
		_.set(Memory, ["sites", "mining", rmHarvest, "is_safe"], is_safe);
		_.set(Memory, ["sites", "mining", rmHarvest, "hostiles"], hostiles);

		if (visible && rmColony != rmHarvest && Game.time % 50 == 0) {
			// Record amount of dropped energy available (for adjusting carrier amounts)
			if (_.get(Memory, ["sites", "mining", rmHarvest, "energy_amounts"]) == null)
				_.set(Memory, ["sites", "mining", rmHarvest, "energy_amounts"], new Array());
			
			_.get(Memory, ["sites", "mining", rmHarvest, "energy_amounts"]).push( 
				{ tick: Game.time, amount: _.sum(_.filter(Game["rooms"][rmHarvest].find(FIND_DROPPED_RESOURCES), 
					res => { return res.resourceType == "energy"; }),
					res => { return res.amount; }) });
		}
	},

	runPopulation: function(rmColony, rmHarvest, listCreeps, listSpawnRooms, hasKeepers, listPopulation) {
		let room_level = Game["rooms"][rmColony].getLevel();
		let has_minerals = _.get(Memory, ["sites", "mining", rmHarvest, "has_minerals"]);
		let threat_level = _.get(Memory, ["rooms", rmColony, "threat_level"]);
		let is_safe = _.get(Memory, ["sites", "mining", rmHarvest, "is_safe"]);		
		let hostiles = _.get(Memory, ["sites", "mining", rmHarvest, "hostiles"], new Array());
		
		let is_safe_colony = _.get(Memory, ["rooms", rmColony, "is_safe"]);
		let is_visible = _.get(Memory, ["sites", "mining", rmHarvest, "visible"]);

		// If the colony is not safe (under siege?) pause spawning remote mining; frees colony spawns to make soldiers
		if (rmColony != rmHarvest && !is_safe_colony)
			return;

		// Is the room visible? If not, only spawn a scout to check the room out!
		if (rmColony != rmHarvest && !is_visible) {
			let lScout = _.filter(listCreeps, c => c.memory.role == "scout");

			if (lScout.length < 1) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 0, level: 1,
				scale_level: false, body: "scout", name: null, args: {role: "scout", room: rmHarvest, colony: rmColony} });
			}
			return;
		}

		let lPaladin = _.filter(listCreeps, c => c.memory.role == "paladin" && (c.ticksToLive == undefined || c.ticksToLive > 200));
		let lSoldier = _.filter(listCreeps, c => c.memory.role == "soldier");
		let lHealer = _.filter(listCreeps, c => c.memory.role == "healer");
		let lDredger = _.filter(listCreeps, c => c.memory.role == "dredger" && (c.ticksToLive == undefined || c.ticksToLive > 100));
		let lBurrower = _.filter(listCreeps, c => c.memory.role == "burrower" && (c.ticksToLive == undefined || c.ticksToLive > 100));
        let lCarrier = _.filter(listCreeps, c => c.memory.role == "carrier" && (c.ticksToLive == undefined || c.ticksToLive > 50));
        let lMiner = _.filter(listCreeps, c => c.memory.role == "miner" && (c.ticksToLive == undefined || c.ticksToLive > 50));
        let lMultirole = _.filter(listCreeps, c => c.memory.role == "multirole" && (c.ticksToLive == undefined || c.ticksToLive > 50));
        let lReserver = _.filter(listCreeps, c => c.memory.role == "reserver");
		let lExtractor = _.filter(listCreeps, c => c.memory.role == "extractor");

		if (listPopulation == null) {
			if (rmColony == rmHarvest)
				listPopulation = _.clone(Population_Mining[`S${Game.rooms[rmHarvest].find(FIND_SOURCES).length}`][Game.rooms[rmColony].controller.level]);
			else if (hasKeepers != true) {
				listPopulation = (is_visible && _.get(Game, ["rooms", rmHarvest]) != null)
			        ? _.clone(Population_Mining[`R${Game.rooms[rmHarvest].find(FIND_SOURCES).length}`][Game.rooms[rmColony].controller.level])
					: _.clone(Population_Mining["R1"][Game.rooms[rmColony].controller.level]);
			} else if (hasKeepers == true)
				listPopulation = _.clone(Population_Mining["SK"]);
		}

		// If remote mining, adjust carrier amount according to average amount of dropped energy over last 1500 ticks		
		if (rmHarvest != rmColony && _.get(listPopulation, ["carrier"]) != null
				&& _.get(Memory, ["sites", "mining", rmHarvest, "energy_amounts"]) != null) {
			let amount = 0;
			let array = _.get(Memory, ["sites", "mining", rmHarvest, "energy_amounts"]);

			for (let i = array.length - 1; i >= 0; i--) {
				if (_.get(array[i], "tick") < Game.time - 1500)
					Memory["sites"]["mining"][rmHarvest]["energy_amounts"].splice(i, 1);
				else
					amount += _.get(array[i], "amount");
			}
			
			let dropped = Math.floor(amount / Memory["sites"]["mining"][rmHarvest]["energy_amounts"].length);			
			let carry_lifetime = [ 4000, 600, 800, 1600, 2600, 3600, 4800, 6600, 6600 ];			
			_.set(listPopulation, ["carrier", "amount"], _.get(listPopulation, ["carrier", "amount"], 0) + Math.round(dropped / carry_lifetime[room_level]));
		}

		// Adjust soldier levels based on threat level
		if (threat_level != NONE) {						
			if (threat_level == LOW || threat_level == null) {
				_.set(listPopulation, ["soldier", "amount"], _.get(listPopulation, ["soldier", "amount"], 0) + Math.max(1, Math.round(room_level / 5)));
				if (is_safe)
					_.set(listPopulation, ["soldier", "level"], Math.max(2, room_level - 2));				
			} else if (threat_level == MEDIUM) {
				_.set(listPopulation, ["soldier", "amount"], _.get(listPopulation, ["soldier", "amount"], 0) + Math.max(2, Math.round(room_level / 3)));
				_.set(listPopulation, ["healer", "amount"], _.get(listPopulation, ["healer", "amount"], 0) + Math.max(1, Math.floor(room_level / 5)));
				if (is_safe) {
					_.set(listPopulation, ["soldier", "level"], Math.max(2, room_level - 1));
					_.set(listPopulation, ["healer", "level"], Math.max(2, room_level - 1));
				}				
			} else if (threat_level == HIGH) {
				_.set(listPopulation, ["soldier", "amount"], _.get(listPopulation, ["soldier", "amount"], 0) + Math.max(5, room_level));
				_.set(listPopulation, ["healer", "amount"], _.get(listPopulation, ["healer", "amount"], 0) + Math.max(2, Math.round(room_level / 3)));
			}				
		}

		// Tally population levels for level scaling
		let popTarget = _.sum(listPopulation, p => { return _.get(p, "amount", 0); });
		let popActual = lPaladin.length + lHealer.length + lDredger.length + lBurrower.length + lCarrier.length 
			+ lMiner.length + lMultirole.length + lReserver.length + lExtractor.length;
        Hive.populationTally(rmColony, popTarget, popActual);

		if (lPaladin.length < _.get(listPopulation, ["paladin", "amount"])) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 0, 
				level: listPopulation["paladin"]["level"],
				scale_level: _.get(listPopulation, ["paladin", "scale_level"], true),
				body: "paladin", name: null, args: {role: "paladin", room: rmHarvest, colony: rmColony} });
		}
		else if ((!hasKeepers && !is_safe && hostiles.length > lSoldier.length + lMultirole.length)
				|| (lSoldier.length < _.get(listPopulation, ["soldier", "amount"]))) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 1,
				level: _.get(listPopulation, ["soldier", "level"], room_level),
				scale_level: _.get(listPopulation, ["soldier", "scale_level"], true),
				body: "soldier", name: null, args: {role: "soldier", room: rmHarvest, colony: rmColony} });
		}
		else if (lHealer.length < _.get(listPopulation, ["healer", "amount"])) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 1, 
				level: listPopulation["healer"]["level"],
				scale_level: _.get(listPopulation, ["healer", "scale_level"], true),
				body: "healer", name: null, args: {role: "healer", room: rmHarvest, colony: rmColony} });
		}
		else if (lMultirole.length < _.get(listPopulation, ["multirole", "amount"])) {
			Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 2, 
				level: listPopulation["multirole"]["level"],
				scale_level: _.get(listPopulation, ["multirole", "scale_level"], true),
				body: _.get(listPopulation, ["multirole", "body"], (hasKeepers ? "worker" : "multirole")),
				name: null, args: {role: "multirole", room: rmHarvest, colony: rmColony} });
        }
		else if (is_safe) {
			if (lMiner.length < _.get(listPopulation, ["miner", "amount"])) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 2, 
					level: listPopulation["miner"]["level"],
					scale_level: _.get(listPopulation, ["miner", "scale_level"], true),
					body: "worker", name: null, args: {role: "miner", room: rmHarvest, colony: rmColony} });
			}
			else if (lDredger.length < _.get(listPopulation, ["dredger", "amount"])) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 1, 
					level: listPopulation["dredger"]["level"],
					scale_level: _.get(listPopulation, ["dredger", "scale_level"], true), 
					body: "dredger", name: null, args: {role: "dredger", room: rmHarvest, colony: rmColony} });
			}
			else if (lBurrower.length < _.get(listPopulation, ["burrower", "amount"])) {
				if (lCarrier.length < _.get(listPopulation, ["carrier", "amount"]) && lMiner.length == 0) { 
					// Possibly colony wiped? Need restart?
					Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 1, level: 1,
						scale_level: true, body: "worker", name: null, args: {role: "miner", room: rmHarvest, colony: rmColony} });
				} else {
					Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 2, 
						level: listPopulation["burrower"]["level"],
						scale_level: _.get(listPopulation, ["burrower", "scale_level"], true),
						body: _.get(listPopulation, ["burrower", "body"], "burrower"),
						name: null, args: {role: "burrower", room: rmHarvest, colony: rmColony} });
				}
			}
			else if (lCarrier.length < _.get(listPopulation, ["carrier", "amount"])) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 2, 
					level: listPopulation["carrier"]["level"],
					scale_level: _.get(listPopulation, ["carrier", "scale_level"], true),
					body: _.get(listPopulation, ["carrier", "body"], "carrier"),
					name: null, args: {role: "carrier", room: rmHarvest, colony: rmColony} });
			}			
			else if (lReserver.length < _.get(listPopulation, ["reserver", "amount"])
						&& Game.rooms[rmHarvest] != null && Game.rooms[rmHarvest].controller != null
						&& (Game.rooms[rmHarvest].controller.reservation == null || Game.rooms[rmHarvest].controller.reservation.ticksToEnd < 2000)) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 2, 
					level: listPopulation["reserver"]["level"],
					scale_level: _.get(listPopulation, ["reserver", "scale_level"], true),
					body: _.get(listPopulation, ["reserver", "body"], "reserver"),
					name: null, args: {role: "reserver", room: rmHarvest, colony: rmColony} });
			}
			else if (lExtractor.length < _.get(listPopulation, ["extractor", "amount"]) && has_minerals) {
				Memory["hive"]["spawn_requests"].push({ room: rmColony, listRooms: listSpawnRooms, priority: 4, 
					level: listPopulation["extractor"]["level"],
					scale_level: _.get(listPopulation, ["extractor", "scale_level"], true),
					body: _.get(listPopulation, ["extractor", "body"], "extractor"),
					name: null, args: {role: "extractor", room: rmHarvest, colony: rmColony} });
			}
		}
	},

	runCreeps: function(rmColony, rmHarvest, listCreeps, hasKeepers, listRoute) {
		let Roles = require("roles");
		let is_safe = _.get(Memory, ["sites", "mining", rmHarvest, "is_safe"]);

        _.each(listCreeps, creep => {
			_.set(creep, ["memory", "list_route"], listRoute);

			switch (creep.memory.role) {
				case "scout": 		Roles.Scout(creep);					break;
				case "extractor": 	Roles.Extracter(creep, is_safe);	break;
				case "reserver": 	Roles.Reserver(creep);				break;
				case "healer": 		Roles.Healer(creep, true);			break;
				
				case "miner": case "burrower": case "carrier":
					Roles.Mining(creep, is_safe);
					break;
				
				case "dredger":
					Roles.Dredger(creep);
					break;

				case "soldier": case "paladin":
					Roles.Soldier(creep, false, true);
					break;
				
				case "multirole":
					if (hasKeepers || is_safe)
						Roles.Worker(creep, is_safe);
					else
						Roles.Soldier(creep, false, true);
					break;
			}
        });
	},

	buildContainers: function(rmColony, rmHarvest) {
		if (Game.time % 1500 != 0)
			return;

		let room = Game["rooms"][rmHarvest];
		if (room == null)
			return;

		let sources = room.find(FIND_SOURCES);
		let containers = _.filter(room.find(FIND_STRUCTURES), s => { return s.structureType == "container"; });				
		_.each(sources, source => {
			if (source.pos.findInRange(containers, 1).length == 0) {
				let adj = source.pos.getOpenTile_Adjacent();
				if (adj != null && adj.createConstructionSite("container") == OK)
					console.log(`<font color=\"#6065FF\">[Mining]</font> ${room.name} placing container at (${adj.x}, ${adj.y})`);					
			}
		});
	}
};
