

// document.body.textContent = "";

// var header = document.createElement('h1');
// header.textContent = "This page has been eaten";
// document.body.appendChild(header);

function move_stuff_around() {
    try {
        console.log("RLDIT GO! / 2");
        let siteTable = document.getElementById('siteTable');
        
        let posts = Array.from(siteTable.children).filter(x => x.classList.contains('thing'))
        console.log(`found ${posts.length} posts`);
        
        var tmp = posts[2];
        posts[2] = posts[0];
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

    console.log('got things started')
    
    let decision = {
        shared: {},
        _multi: []
    };

    if(user)
        decision.shared.user = user;
    if(pathName)
        decision.shared.path = pathName;
    console.log('so fair: ' + JSON.stringify(decision));

    var posts  = document.body.querySelectorAll('div.thing');
    for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        /* TODO
            engineer the numerical features
        */
       try {
            var action = {
                meta: {
                    __idx: i,
                    subreddit: post.attributes["data-subreddit"].value,
                    author: post.attributes["data-author"].value,
                    comment_count: parseInt(post.attributes["data-comments-count"].value),
                    data_score: parseInt(post.attributes["data-score"].value),
                    nsfw: post.attributes["data-nsfw"].value,
                    promoted: post.attributes["data-promoted"].value,
                    spoiler: post.attributes["data-spoiler"].value,
                    crossPosts: parseInt(post.attributes["data-num-crossposts"].value),
                    score: parseInt(post.attributes["data-score"].value),
                    domain: post.attributes["data-domain"].value
                },
                fullText: {
                    title: post.querySelector('a.title').text
                }
            };

            for(var j = 0 ; j < post.classList.length; ++j) {
                var className = post.classList[j];
                if(className.startsWith("linkflair-") || className == "gilded" || className == "self") {
                    action.meta[className] = "true";
                }
            }
            decision._multi.push(action);
        } catch(e) {
            console.log(e);
        }
    }
    console.log(JSON.stringify(decision));
};

var Module = {
    print: function(text) { console.log('stdout: ' + text) },
    printErr: function(text) { console.log('stderr: ' + text) },
    onRuntimeInitialized: function() {
        console.log('vw module initialized!');
        try {
            let ex = Module.new_example_predict();
            let ex_builder = new Module.example_predict_builder(ex, "test");
            ex_builder.push_feature_string("test", 1.0);

            let vw = new Module.vw_predict();
            let action_list = new Module.action_list();

            let res = vw.predict("test", null, action_list);
            console.log(res);
            let a = res.get_pdf();
            for (var i = 0; i < a.size(); i++) {
                    console.log("Vector Value: ", a.get(i));
            }
            console.log(res.get_ranking());
        } catch(e) {
            console.log('vw fail ' + e)
        }
    },
    instantiateWasm: function(info, receiveInstance) {
        var wasmModuleUrl = browser.extension.getURL('vwslim.wasm');
        async function resolveModule() {
            try {
                let response = await fetch(wasmModuleUrl, { credentials: 'same-origin' });
                let wasmModule = await WebAssembly.instantiateStreaming(response, info);
                receiveInstance(wasmModule["instance"])
            } catch(e) {
                console.log('failed to fetch wasm module due to ' + e);
            }
        };

        resolveModule();

        return { };
    }
}
