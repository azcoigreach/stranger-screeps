let Tasks = require("tasks");

module.exports = {
	
	acquireBoost: function(creep) {
		if (creep.room.name == creep.memory.colony) {
			if (creep.memory.boost == null && !creep.isBoosted()) {
				return this.seekBoost(creep);
			} else if (creep.memory.boost != null && !creep.isBoosted()) {
				creep.travel(new RoomPosition(creep.memory.boost.pos.x, creep.memory.boost.pos.y, creep.memory.boost.pos.roomName));
				return true;
			}
		}
	},

	seekBoost: function(creep) {
		if (creep.isBoosted())
			return false;
		else {
			let task = _.head(_.filter(Memory["rooms"][creep.room.name]["tasks"],
				t => { 
				return t.type == "boost" 
					&& t.role == creep.memory.role 
					&& t.subrole == creep.memory.subrole
					&& (t.dest == null ? true : t.dest == creep.memory.room); }));
				
			if (task != null) {
				creep.memory.boost = task;
				return true;
			} else
				return false;
		}
	},

	moveToDestination: function(creep, recheck_targets) {
		if (creep.memory.room != null && creep.memory.target == null && creep.room.name != creep.memory.room) {
			creep.travelToRoom(creep.memory.room, true);
			// Evaluates for targets in this room every evaluate_targets ticks...
			return (recheck_targets == null || Game.time % recheck_targets != 0);
		}
		return false;
	},

	checkTarget_Existing: function(creep) {
		if (creep.memory.target != null) {
			let target = Game.getObjectById(creep.memory.target);
			// Refresh target every 10 ticks...
			if (target == null || target.room.name != creep.room.name || Game.time % 10 == 0)
				delete creep.memory.target;
		}
	},

	acquireTarget_ListTarget: function(creep, listTargets) {
		if (creep.memory.target == null) {
			for (let t in listTargets) {
				let target = Game.getObjectById(listTargets[t]);
				if (target != null && creep.moveTo(target) != ERR_NO_PATH) {
					creep.memory.target = target.id;
					return;
				}
			}
		}
	},
	
	acquireTarget_Creep: function(creep) {
		if (creep.memory.target == null) {
			if (_.get(Memory, ["rooms", creep.room.name, "target_attack"]) != null) {
				creep.memory.target = _.get(Memory, ["rooms", creep.room.name, "target_attack"]);
				return;
			}

			let target = _.head(_.sortBy(_.sortBy(_.sortBy(creep.room.find(FIND_HOSTILE_CREEPS, 
				{ filter: (c) => { return c.isHostile(); }}),				
				c => { return -(c.getActiveBodyparts(ATTACK) + c.getActiveBodyparts(RANGED_ATTACK) 
					+ c.getActiveBodyparts(HEAL)) + c.getActiveBodyparts(WORK); })),
				c => { return c.pos.getRangeTo(creep.pos); }),
				c => { return c.owner.username == "Source Keeper"; });				
			if (target != null) {
				creep.memory.target = target.id;
				return;
			}
		}
	},
	
	acquireTarget_Structure: function(creep) {
		if (creep.memory.target == null) {			
			let target = _.head(_.sortBy(_.sortBy(_.sortBy(creep.room.find(FIND_STRUCTURES, { filter:
				s => { return s.hits != null && s.hits > 0
					&& (s.owner != null && !s.my && _.get(Memory, ["hive", "allies"]).indexOf(s.owner.username) < 0); }}),
				s => { return creep.pos.getRangeTo(s.pos); } ),
				s => { return s.hits; } ),	// Sort by hits to prevent attacking massive ramparts/walls forever
				s => { switch (s.structureType) {
					case "spawn": return 0;
					case "tower": return 1;
					case "extension": return 2;
					default: return 3;
					case "rampart":
					case "constructedWall": return 4;
				}}));
			if (target == null)
				target = _.head(_.sortBy(creep.room.find(FIND_CONSTRUCTION_SITES, { filter:
					s => { return s.owner == null || (!s.my && _.get(Memory, ["hive", "allies"]).indexOf(s.owner.username) < 0); }}),
					s => { return creep.pos.getRangeTo(s.pos); } ));
				
			if (target != null)
				creep.memory.target = target.id;
		}
	},	

	setCamp: function(creep) {
		if (creep.memory.camp != null || Game.time % 10 != 0)
			return;

		if (creep.room.name == creep.memory.room) {
			let lair = _.head(_.sortBy(_.filter(creep.room.find(FIND_STRUCTURES), 
				s => { return s.structureType == "keeperLair"; }),
				s => { return s.ticksToSpawn; }));		
			if (lair != null) {
				_.set(creep.memory, "camp", lair.id);
				return;
			} 
		
			let structures = creep.room.find(FIND_MY_STRUCTURES);
			let ramparts = _.filter(structures, 
				s => { return s.structureType == "rampart" && s.pos.lookFor(LOOK_CREEPS).length == 0; });					
			let rampart = creep.pos.findClosestByPath(ramparts);
			if (rampart != null) {
				_.set(creep.memory, "camp", rampart.id);
				return;
			} 

			let controller = _.head(_.filter(structures, s => { return s.structureType == "controller"}));
			if (controller != null) {				
				_.set(creep.memory, "camp", controller.pos.getOpenTile_Range(3, true));
				return;
			}
		}
	},

	moveToCamp: function(creep) {
		let camp = _.get(creep.memory, "camp");
		if (camp != null) {
			if (camp instanceof RoomPosition == true) {
				creep.travel(camp);
				return;
			} else if (_.get(camp, "x") != null && _.get(camp, "y") != null && _.get(camp, "roomName") != null) {
				creep.travel(new RoomPosition(camp.x, camp.y, camp.roomName));
			} else {
				let obj = Game.getObjectById(_.get(creep.memory, "camp"));
				if (obj == null)
					_.set(creep.memory, "camp", null);
				else
					creep.travel(obj);
			}
		}
	}
}