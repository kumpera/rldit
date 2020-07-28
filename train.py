import json
import random
import re
file_dump = json.load(open("sample-home.json"))

def ns_to_str(name, ns):
    example_string = f' |{name}'
    for f in ns:
        val = ns[f]
        if isinstance(val, str):
            # val = pattern.replace(val, '_')
            val = re.sub(r'[^a-zA-Z0-9]', '_', val)

            example_string += f' {f}={val}'
        else:
            example_string += f' {f}:{val}'
    return example_string

def to_vw_example(decision, chosen_action, cost, prob):
    example_string = 'shared'
    for ns in decision['shared']:
        ns_dict = decision['shared'][ns]
        example_string += ns_to_str(ns, ns_dict)
    example_string += "\n"

    for i in range(0, len(decision['actions'])):
        action = decision['actions'][i]
        if i == chosen_action:
            example_string += f'0:{cost}:{prob}'
        for ns in action:
            ns_dict = action[ns]
            example_string += ns_to_str(ns, ns_dict)
        if i < len(decision['actions']) -1:
            example_string += "\n"

    return example_string


action_count = len(file_dump['actions'])
with open("train.vw", 'w+') as train_file:
    for i in range(0, 1000):
        chosen_action = random.randint(0, action_count - 1)
        cost = 0
        meta = file_dump['actions'][chosen_action]["meta"]
        # gift are the best
        # if meta["subreddit"] == "gifs":
            # cost = -1
        # good news second best
        # if meta["subreddit"] == "UpliftingNews":
        if meta["subreddit"] == "Showerthoughts":
            cost = -1
        
        # promoted content is never interesting
        if "promoted" in meta and meta["promoted"] == "true":
            cost = 1
        
        train_file.write(to_vw_example(file_dump, chosen_action, cost, 0.2))
        train_file.write('\n\n')