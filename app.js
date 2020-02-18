const PORT = process.env.PORT || 3000;
const express = require("express");
const app = express();
require("dotenv").config();

app.use(express.json());

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const shortid = require("shortid");
const NanoTimer = require("nanotimer");

const adapter = new FileSync("db.json");
const db = low(adapter);

const Mux = require("@mux/mux-node");
const { Video, Data } = new Mux();

const server = app.listen(PORT, function() {
  console.log(`Listening on Port ${PORT}`);
});

const socketio = require("socket.io")(server);

function getPlaylist(playlistId) {
  const playlist = db
    .get("playlists")
    .find({ name: playlistId })
    .value();
  return playlist;
}

function getVideo(videoId) {
  const video = db
    .get("videos.entries")
    .find({ id: videoId })
    .value();

  return video;
}

function getDuration(data) {
  const duration = data
    .map(item => item.duration)
    .reduce((prev, curr) => prev + curr, 0);
  return duration;
}

function updateTotals() {
  const playlistArray = db
  .get("playlists.entries")
  .value();

  for (i = 0; i < playlistArray.length; i++) { 

    var sum = Object.values(playlistArray[i].videos).reduce((t, {duration}) => t + duration, 0)

    playlistArray[i]["total"] = sum;
  }

  db.get("playlists")
    .set("entries", playlistArray)
    .write();
}

function getLive() {
  const durationArray = db
    .get("playlists.entries")
    .map("total")
    .value();

  const playlistsArray = db.get("playlists.entries").value();

  const playlistsTotal = durationArray.reduce(function(a, b) {
    return a + b;
  });

  var result = { index: 0, sum: 0, total: playlistsTotal };

  var liveSeconds = live / 100;

  durationArray.some(function(a, i) {
    this.index = i;
    if (this.sum + a > liveSeconds) {
      return true;
    }
    this.sum += a;
  }, result);

  const currentPlaylist = playlistsArray[result.index];

  result.playlist = currentPlaylist.id;

  const playlistDurations = currentPlaylist.videos.map(function(item) {
    return item.duration;
  });

  const playlistTotal = playlistDurations.reduce(function(a, b) {
    return a + b;
  });

  var currentVideo = {
    index: 0,
    sum: 0,
    total: playlistTotal
  };

  const playlistLive = liveSeconds - result.sum;
  result.playlistLive = playlistLive;
  playlistDurations.some(function(a, i) {
    this.index = i;
    if (this.sum + a > playlistLive) {
      return true;
    }
    this.sum += a;
  }, currentVideo);

  var video = currentPlaylist.videos[currentVideo.index];

  if (currentPlaylist.videos[currentVideo.index + 1]) {
    var nextVideo = currentPlaylist.videos[currentVideo.index + 1];
    result.next = getVideo(nextVideo.id);
  } else {
    if (playlistsArray[result.index + 1]) {
      var nextVideo = playlistsArray[result.index + 1].videos[0];
      result.next = getVideo(nextVideo.id);
    } else {
      var nextVideo = playlistsArray[0].videos[0];
      result.next = getVideo(nextVideo.id);
    }
  }

  result.index = currentVideo.index;

  result.current = getVideo(video.id);

  result.current["live"] = liveSeconds - (result.sum + currentVideo.sum);

  result.current.index = currentVideo.index;

  return result;

}

var timer = new NanoTimer();

var live = 0;

var total = getLive().total * 1000;

var setLive = function() {
  if (live / 100 < total / 1000) {
    live++;
  } else {
    live = 0;
  }
  // console.log(live / 100 + "/" + total / 1000);
};

timer.setInterval(setLive, "", "10m");

app.get("/total", function(req, res) {
  total = total + 2000;

  var obj = {
    value: total / 1000,
    live: live / 100
  };
  res.send(obj);
});

app.post("/asset", function(req, res) {
  var user_id = req.body.id;
  var video_id = shortid.generate();
  var asset_obj = {
    "video_id": video_id,
    "user_id": user_id
  };
  var json = JSON.stringify(asset_obj);
  console.log(json);
  Video.Uploads.create({
    cors_origin: "http://localhost:8080",
    new_asset_settings: {
      playback_policy: "public",
      passthrough: json
    }
  }).then(upload => {
    var obj = {
      id: video_id,
      url: upload.url
    };
    res.send(obj);

  }).catch(error => { res.send(error) });

});

app.post("/auth", async function(req, res) {

   var user = db.get("users").find({ username: req.body.username }).value();
     console.log(user);
   var member = db.get("members").find({ username: req.body.username }).value();
  
   res.send(member);
});

app.post("/ping", async function(req, res) {
  socketio.emit("ping", req.body);
  res.send(req.body);
});

app.post("/new_asset", async function(req, res) {
  const { type: eventType, data: eventData } = await req.body;

  switch (eventType) {
    case "video.asset.ready": {
      
      var passthrough = JSON.parse(eventData.passthrough);
      console.log(passthrough);
      var obj = {
        url: "https://stream.mux.com/" + eventData.playback_ids[0].id + ".m3u8",
        duration: eventData.duration,
        caption: "",
        user: passthrough.user_id,
        thumbnail:
          "https://image.mux.com/" +
          eventData.playback_ids[0].id +
          "/animated.gif",
        date: eventData.created_at,
        playlist: [""],
        id: passthrough.video_id,
        asset_id: eventData.id,
        status: "uploaded",
        index: null
      };

      console.log(obj);

      db.get("videos.entries")
      .push(obj)
      .write();
var userid = passthrough.user_id.toString();
var videoid = passthrough.video_id.toString();

      db.get("members")
      .find({ id: userid })
      .get("uploads")
      .push(passthrough.video_id)
      .write();

      const user = db
    .get("members")
    .find({ id: userid })
    .value();

      console.log(user);

      socketio.emit("ping", obj);
    }
  }

  res.send(eventType);
});

app.get("/live", function(req, res) {
  var obj = getLive();
  res.send(obj); //respond with the array of courses
});

app.get("/playlists", function(req, res) {
  res.send(db.get("playlists"));
});

app.get("/members", function(req, res) {
  res.send(db.get("members"));
});

app.get("/members/:id", function(req, res) {
  
  var user = db.get("members")
      .find({ id: req.params.id })
  
   res.send(user);

});

app.get("/playlists/:id", function(req, res) {
  const playlist = getPlaylist(req.params.id);

  if (!playlist) {
    return res.status(404).send("The playlist with the given id was not found");
  }
  //return the object
  res.send(playlist);
});

app.get("/playlists/:id/videos", function(req, res) {
  //return the object
  const playlist = getPlaylist(req.params.id);

  if (!playlist) {
    return res.status(404).send("The playlist with the given id was not found");
  }

  res.send(playlist.videos);
});

app.get("/videos", function(req, res) {
  res.send(db.get("videos"));
});

app.get("/videos/duration", function(req, res) {
  const videos = db.get("videos");
  const duration = videos
    .map(item => Number(item.duration))
    .reduce((prev, curr) => prev + curr, 0);

  const obj = {
    total: duration
  };
  res.send(obj);
});

app.get("/videos/:id", function(req, res) {
  //return the object
  const video = getVideo(req.params.id);

  if (!video) {
    return res.status(404).send("The video with the given id was not found");
  }

  res.send(video);
});

app.get("/playlists/:id/duration", function(req, res) {
  //return the object
  const playlist = getPlaylist(req.params.id);

  if (!playlist) {
    return res.status(404).send("The playlist with the given id was not found");
  }

  const duration = getDuration(playlist.videos);

  const obj = {
    total: duration
  };
  res.send(obj);
});

app.post("/add", function(req, res) {
  const video = req.body;
  videoId = shortid.generate();
  video["id"] = videoId;

  var video_small = {
    date: video.date,
    duration: video.duration,
    id: videoId
  };

  db.get("playlists")
    .find({ name: "default" })
    .get("videos")
    .push(video_small)
    .write();

  updateTotals();
  
  db.push("videos.entries", video).write();

  res.send(video);
});

app.put("/videos/update", function(req, res) {
  db.get("videos")
    .set("entries", req.body)
    .write();

  updateTotals();
});

app.put("/playlists/update", function(req, res) {
  db.get("playlists")
    .set("entries", req.body)
    .write();

  updateTotals();

  res.send(db.get("playlists"));
});

app.get("/archive", function(req, res) {
  res.send(db.get("archive"));
});

app.post("/archive", function(req, res) {
  const video = req.body;
  db.get("archive.videos")
    .push(video)
    .write();

  res.send(db.get("archive"));
});
app.post("/add/:id", function(req, res) {
  const playlist = getPlaylist(req.params.id);
  const video = req.body;
  const videoId = shortid.generate();
  video["id"] = videoId;
  var video_obj = {
    date: video.date,
    duration: video.duration,
    id: videoId
  };
  if (!playlist) {
    var playlist_obj = {
      id: shortid.generate(),
      name: req.params.id,
      duration: video.duration,
      videos: []
    };

    playlist_obj.videos.push(video_obj);

    db.get("playlists")
      .push(playlist_obj)
      .write();

    db.push("videos.entries", video).write();

    res.send(videoObj);
  } else {
    db.get("playlists")
      .find({ name: req.params.id })
      .get("videos")
      .push(video_obj)
      .write();

    const duration = getDuration(playlist.videos);

    db.get("playlists")
      .find({ name: req.params.id })
      .set("total", duration)
      .write();

    db.get("videos.entries")
      .push(video)
      .write();

    const videos = db.get("videos").value();
    const total = getDuration(videos.entries);

    db.get("videos")
      .set("total", total)
      .write();

    res.send(playlist);
  }
});
