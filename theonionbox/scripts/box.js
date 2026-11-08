%# // Note that this file is not a valid *.js script!
%# // It is intended to be a bottlepy - style template
%# // used for the scripting part of TheOnionBox!
%# // It only serves the login & error pages: the dashboard is the single page app in 'web/'.

// # The Onion Box

<%
    for section in sections:

        special = section[0]
        if special == '!' or special == '-':
            continue
        end

        file = 'sections/{0}/{0}.js'.format(section)
        try:
            include(file)
        except Exception as exc:
            import logging
            bL = logging.getLogger('theonionbox')
            bL.debug("While including '{}' into 'box.js': {}".format(file, exc))
        end
    end
%>
