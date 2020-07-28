function getPostList() {
    return Array.from(document.getElementById('siteTable').children).filter(x => x.classList.contains('thing'));
}

function promote_best_post(best_slot) {
    try {
        console.log(`RLDIT is going to promote slot ${best_slot}`);
        if(best_slot == 0) {
            console.log("best slot already to slot. bye");
            return;
        }

        let siteTable = document.getElementById('siteTable');

        let posts = getPostList();
        console.log(`found ${posts.length} posts`);

        var tmp = posts[best_slot];
        posts[best_slot] = posts[0];
        posts[0] = tmp;

        const frag = document.createDocumentFragment();
        var j = 0;
        var orig = Array.from(siteTable.children);
        siteTable.innerHTML = '';

        for(var i = 0; i < orig.length; ++i) {
            var node = orig[i];
            if(node.classList.contains('thing')) {
                // console.log('adding post ' + posts[j].attributes["data-subreddit"].value);
                siteTable.append(posts[j++]);
            } else {
                // console.log(`adding misc + ${node.className} `);
                siteTable.appendChild(node);
            }
        }
        console.log("DONE!")
    } catch(e) {
         console.log(e);
    }
};

function produce_decision_json() {
    console.log('creating decision');
    var userSpan = document.querySelector('span.user');
    var user = userSpan ? userSpan.firstChild.text : null;

    var pathName = window.location.pathname;
    var location = null;
    if (pathName == "/")
        location = "home";
    else if(pathName.startsWith("/r/"))
        location = pathName.substring(3, pathName.length - 1);

    let decision = {
        shared: {
            context: {}
        },
        actions: []
    };

    if(user)
        decision.shared.context.user = user;
    if(pathName)
        decision.shared.context.path = location;
    console.log('so fair: ' + JSON.stringify(decision));

    var posts = getPostList();
    for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        /* TODO
            engineer the numerical features
        */
       try {
            var action = {
                meta: {
                    // __idx: i, //drop this from actual prediction
                    subreddit: post.attributes["data-subreddit"].value,
                    // author: post.attributes["data-author"].value,
                    // comment_count: parseInt(post.attributes["data-comments-count"].value),
                    // data_score: parseInt(post.attributes["data-score"].value),
                    // nsfw: post.attributes["data-nsfw"].value,
                    // promoted: post.attributes["data-promoted"].value,
                    // spoiler: post.attributes["data-spoiler"].value,
                    // crossPosts: parseInt(post.attributes["data-num-crossposts"].value),
                    // score: parseInt(post.attributes["data-score"].value),
                    // domain: post.attributes["data-domain"].value,
                },
                //We first have to figure out how to tokenize it properly
                // fullText: {
                //     title: post.querySelector('a.title').text
                // }
            };

            // for(var j = 0 ; j < post.classList.length; ++j) {
            //     var className = post.classList[j];
            //     if(className.startsWith("linkflair-") || className == "gilded" || className == "self") {
            //         action.meta[className] = "true";
            //     }
            // }
            decision.actions.push(action);
        } catch(e) {
            console.log(e);
        }
    }
    console.log(JSON.stringify(decision));
}

let _slimResolve, _slimReject;
let _slimReady = new Promise( (resolve,reject) => {
    _slimResolve = resolve;
    _slimReject = reject;
});
async function loadSlimRuntime() {
    return await _slimReady;
}

var Module = {
    print: function(text) { console.log('stdout: ' + text) },
    printErr: function(text) { console.log('stderr: ' + text) },
    noInitialRun: true,
    onRuntimeInitialized: function() {
        console.log('vw module initialized!');
        _slimResolve(Module);
    },
    instantiateWasm: function(info, receiveInstance) {
        var wasmModuleUrl = browser.extension.getURL('vw.wasm');
        async function resolveModule() {
            try {
                let response = await fetch(wasmModuleUrl, { credentials: 'same-origin' });
                let wasmModule = await WebAssembly.instantiateStreaming(response, info);
                receiveInstance(wasmModule["instance"])
            } catch(e) {
                console.log('failed to fetch wasm module due to ' + e);
                _slimReject(e);
            }
        };

        resolveModule();

        return { };
    }
}

let _vwModelFile = null;
function loadVWModel() {
    async function doLoad() {
        try {
            var vwModelUrl = browser.extension.getURL('sample.model');
            let response = await fetch(vwModelUrl, { credentials: 'same-origin' });
            let model = await response.arrayBuffer();
            console.log('vw model loaded');
            return model;
        } catch(e) {
            console.log('failed to fetch vw model due to ' + e);
        }
    }
    if(!_vwModelFile)
        _vwModelFile = doLoad();
    return _vwModelFile;
}
//do it in parallel with loading slim
// loadVWModel();

let _vwPredict = null;
function loadVwPredict() {
    async function doLoad() {
        try {
            let model = await loadVWModel();
            let rt = await loadSlimRuntime();

            //FIXME use https://github.com/emscripten-core/emscripten/issues/5519 instead
            var ptr = rt._malloc(model.byteLength);
            var heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, model.byteLength);
            heapBytes.set(new Uint8Array(model));
            let vw = new rt.vw_predict(ptr, model.byteLength);
            console.log("vw model loaded");
            return vw;
        } catch(e) {
            console.log('vw fail ' + e)
            throw e;
        }
    }
    if(!_vwPredict)
        _vwPredict = doLoad();
    return _vwPredict;
}
//kick off loading predict
// loadVwPredict();

function add_feature(ex_builder, name, value) {
    // console.log(`${name}::${value}`);
    if(typeof value === "string" || value == null) {
        if(value)
            value = value.replace(new RegExp('[^a-zA-Z0-9]', "gm"), '_');
        ex_builder.push_feature_string(name + "=" + value, 1.0);
    }
    else {
        ex_builder.push_feature_string(name, value);
    }
}

async function make_rl_decision() {
    const vw_predict = await loadVwPredict();

    let shared = Module.new_example();
    let builder = new Module.example_predict_builder(Module.get_inner_example_predict(shared), "context");

    var userSpan = document.querySelector('span.user');
    var user = userSpan ? userSpan.firstChild.text : null;
    add_feature(builder, "user", user);

    var pathName = window.location.pathname;
    var location = null;
    if (pathName == "/")
       location = "home";
    else if(pathName.startsWith("/r/"))
        location = pathName.substring(3, pathName.length - 1);
    add_feature(builder, "path", location);

    builder.delete();

    let actions = []

    var posts = getPostList();
    for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        let action = Module.new_example();
        let ac_builder = new Module.example_predict_builder(Module.get_inner_example_predict(action), "meta");

        try {
            add_feature(ac_builder, 'subreddit', post.attributes["data-subreddit"].value);
            // add_feature(ac_builder, 'author', post.attributes["data-author"].value);
            // add_feature(ac_builder, 'comment_count', parseInt(post.attributes["data-comments-count"].value));
            // add_feature(ac_builder, 'data_score', parseInt(post.attributes["data-score"].value));
            // add_feature(ac_builder, 'nsfw', post.attributes["data-nsfw"].value);
            // add_feature(ac_builder, 'promoted', post.attributes["data-promoted"].value);
            // add_feature(ac_builder, 'spoiler', post.attributes["data-spoiler"].value);
            // add_feature(ac_builder, 'crossPosts', parseInt(post.attributes["data-num-crossposts"].value));
            // add_feature(ac_builder, 'score', parseInt(post.attributes["data-score"].value));
            // add_feature(ac_builder, 'domain', post.attributes["data-domain"].value);

            // for(var j = 0 ; j < post.classList.length; ++j) {
            //     var className = post.classList[j];
            //     if(className.startsWith("linkflair-") || className == "gilded" || className == "self") {
            //         add_feature(ac_builder, className, "true");
            //     }
            // }
            ac_builder.delete();
            actions.push(action);
        } catch(e) {
            console.log('fuuu: ' + e);
            console.log(post);
        }
    }

    let action_list = new Module.action_list();
    actions.forEach(a => action_list.add_action(a));

    let guid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    let prediction = vw_predict.predict(guid, shared, action_list);

    promote_best_post(prediction.get_ranking().get(0));
    return "done";
};

make_rl_decision().then(r => {
    console.log('decision worked ' + r);
}, e => {
    console.log('failed due to ' + e);
});


// produce_decision_json()